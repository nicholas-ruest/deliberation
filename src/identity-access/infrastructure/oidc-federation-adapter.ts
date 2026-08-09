import type { Result } from '../../shared/domain/result.js';
import type { ReplayStore } from '../../platform/security/trusted-identity.js';
import type { ExternalIdentity, FederationPort } from './federation-ports.js';
import { JwksKeySource, SUPPORTED_JWS_ALGORITHMS, verifyJwsSignature, type JwksKeySourceOptions } from './oidc-jwks.js';

export interface OidcFederationConfig {
  /** Recorded verbatim on the resulting `ExternalIdentity`; identifies which registration produced it. */
  readonly provider: string;
  /** The exact `iss` value the issuer stamps on its tokens. Compared byte-for-byte. */
  readonly issuer: string;
  readonly jwksUri?: string;
  /** Defaults to every algorithm in `SUPPORTED_JWS_ALGORITHMS`; narrow it to what your issuer signs with. */
  readonly allowedAlgorithms?: readonly string[];
  /** Claim whose value becomes `ExternalIdentity.tenantHint` — typically a group, org, or domain claim. */
  readonly tenantHintClaim?: string;
  /** Claims copied into `ExternalIdentity.displayAttributes`. Nothing else from the token is carried across. */
  readonly displayAttributeClaims?: readonly string[];
  readonly clockSkewSeconds?: number;
  readonly maxTokenLifetimeSeconds?: number;
  /** Test-only escape hatch for a plaintext issuer URL. Production federation must be over TLS. */
  readonly allowInsecureIssuerTransport?: boolean;
}

export interface OidcFederationOptions extends JwksKeySourceOptions {
  readonly keySource?: JwksKeySource;
  /**
   * When supplied, each accepted assertion is consumed exactly once by `nonce` (or `jti`), so a
   * captured ID token cannot be exchanged for an internal identity twice. Wire the same
   * Postgres-backed store `TrustedIdentityVerifier` uses and the guarantee holds across replicas.
   */
  readonly replay?: ReplayStore;
}

export const DEFAULT_DISPLAY_ATTRIBUTE_CLAIMS: readonly string[] = ['name', 'preferred_username', 'email', 'email_verified'];

export class InvalidOidcFederationConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidOidcFederationConfigError';
  }
}

/**
 * Reference `FederationPort` implementation for OIDC (ADR-050): the one-time exchange of an
 * external, issuer-signed ID token for an `ExternalIdentity` this platform can map to a principal.
 *
 * This is upstream of, and distinct from, `TrustedIdentityVerifier` (ADR-033/034), which verifies
 * this platform's own short-lived session tokens on every request. Nothing here issues a session.
 *
 * It is a documented starting point, not a production default. An adopter still supplies their own
 * issuer, audience, and claim mapping — this exists so that configuration has a working, real-IdP
 * tested implementation to point at rather than an interface with no examples. SAML and SCIM
 * remain unimplemented and are deliberately out of ADR-050's scope.
 */
export class OidcFederationAdapter implements FederationPort {
  readonly protocol = 'oidc';

  private readonly keys: JwksKeySource;
  private readonly replay: ReplayStore | undefined;
  private readonly allowedAlgorithms: ReadonlySet<string>;
  private readonly tenantHintClaim: string | undefined;
  private readonly displayAttributeClaims: readonly string[];
  private readonly clockSkewSeconds: number;
  private readonly maxTokenLifetimeSeconds: number;

  constructor(private readonly config: OidcFederationConfig, options: OidcFederationOptions = {}) {
    if (config.issuer.length === 0 || config.provider.length === 0) {
      throw new InvalidOidcFederationConfigError('OIDC federation requires a non-empty provider and issuer');
    }
    if (!config.issuer.startsWith('https://') && config.allowInsecureIssuerTransport !== true) {
      throw new InvalidOidcFederationConfigError(`OIDC federation issuer "${config.issuer}" must use https`);
    }
    const allowed = config.allowedAlgorithms ?? SUPPORTED_JWS_ALGORITHMS;
    const unsupported = allowed.filter((algorithm) => !SUPPORTED_JWS_ALGORITHMS.includes(algorithm));
    if (allowed.length === 0 || unsupported.length > 0) {
      throw new InvalidOidcFederationConfigError(`Unsupported OIDC signature algorithms: ${unsupported.join(', ') || '(none configured)'}`);
    }
    this.allowedAlgorithms = new Set(allowed);
    this.keys = options.keySource ?? new JwksKeySource(config.issuer, options);
    this.replay = options.replay;
    this.tenantHintClaim = config.tenantHintClaim;
    this.displayAttributeClaims = config.displayAttributeClaims ?? DEFAULT_DISPLAY_ATTRIBUTE_CLAIMS;
    this.clockSkewSeconds = config.clockSkewSeconds ?? 60;
    this.maxTokenLifetimeSeconds = config.maxTokenLifetimeSeconds ?? 86_400;
  }

  async validate(assertion: string, expectedAudience: string, now: Date): Promise<Result<ExternalIdentity>> {
    const parts = assertion.split('.');
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    if (parts.length !== 3 || encodedHeader === undefined || encodedPayload === undefined || encodedSignature === undefined) {
      return denied('Malformed OIDC assertion', 'malformed_assertion');
    }

    let header: Record<string, unknown>;
    let claims: Record<string, unknown>;
    try {
      header = JSON.parse(decode(encodedHeader)) as Record<string, unknown>;
      claims = JSON.parse(decode(encodedPayload)) as Record<string, unknown>;
    } catch {
      return denied('Malformed OIDC assertion', 'malformed_assertion');
    }
    if (typeof header !== 'object' || header === null || typeof claims !== 'object' || claims === null) {
      return denied('Malformed OIDC assertion', 'malformed_assertion');
    }

    const { alg, kid, typ, crit } = header;
    // An unrecognised `crit` header means the issuer requires an extension this adapter does not
    // implement; the specification requires rejecting rather than silently ignoring it.
    if (typeof alg !== 'string' || !this.allowedAlgorithms.has(alg) || typeof kid !== 'string' || crit !== undefined
      || (typ !== undefined && (typeof typ !== 'string' || typ.toUpperCase() !== 'JWT'))) {
      return denied('OIDC assertion header denied', 'unsupported_algorithm');
    }
    if (claims['iss'] !== this.config.issuer) return denied('Untrusted OIDC issuer', 'untrusted_issuer');

    const audienceCheck = checkAudience(claims, expectedAudience);
    if (audienceCheck !== undefined) return audienceCheck;

    const signingKey = await this.keys.keyFor(kid, now.getTime());
    if (!signingKey.ok) return signingKey;
    const signature = Buffer.from(encodedSignature, 'base64url');
    if (!verifyJwsSignature(alg, Buffer.from(`${encodedHeader}.${encodedPayload}`, 'ascii'), signature, signingKey.value)) {
      return denied('Invalid OIDC assertion signature', 'invalid_signature');
    }

    const nowSeconds = Math.floor(now.getTime() / 1000);
    const { exp, iat, nbf, sub } = claims;
    if (typeof sub !== 'string' || sub.length === 0
      || typeof exp !== 'number' || !Number.isFinite(exp) || exp + this.clockSkewSeconds <= nowSeconds
      || typeof iat !== 'number' || !Number.isFinite(iat) || iat - this.clockSkewSeconds > nowSeconds
      || exp - iat > this.maxTokenLifetimeSeconds
      || (nbf !== undefined && (typeof nbf !== 'number' || !Number.isFinite(nbf) || nbf - this.clockSkewSeconds > nowSeconds))) {
      return denied('Invalid OIDC assertion claims', 'invalid_claims');
    }

    if (this.replay !== undefined) {
      const singleUseId = firstString(claims['nonce'], claims['jti']);
      if (singleUseId === undefined) return denied('OIDC assertion carries no nonce or jti to consume', 'missing_replay_identifier');
      if (!await this.replay.consume(`oidc:${this.config.issuer}:${singleUseId}`, Math.ceil(exp))) {
        return denied('Replayed OIDC assertion', 'replayed_assertion');
      }
    }

    const tenantHint = this.tenantHintClaim === undefined ? undefined : asAttribute(claims[this.tenantHintClaim]);
    const displayAttributes: Record<string, string> = {};
    for (const claim of this.displayAttributeClaims) {
      const value = asAttribute(claims[claim]);
      if (value !== undefined) displayAttributes[claim] = value;
    }
    return {
      ok: true,
      value: {
        provider: this.config.provider,
        issuer: this.config.issuer,
        subject: sub,
        ...(tenantHint === undefined ? {} : { tenantHint }),
        displayAttributes,
      },
    };
  }
}

/**
 * OIDC allows more than one audience, but a multi-audience token is only addressed to this
 * platform if `azp` names it — otherwise a token minted for a different relying party that merely
 * lists us would be accepted.
 */
function checkAudience(claims: Record<string, unknown>, expectedAudience: string): Result<never> | undefined {
  const audience = claims['aud'];
  const audiences = typeof audience === 'string'
    ? [audience]
    : Array.isArray(audience) && audience.every((entry) => typeof entry === 'string')
      ? (audience as string[])
      : undefined;
  if (audiences === undefined || !audiences.includes(expectedAudience)) return denied('Untrusted OIDC audience', 'invalid_audience');
  if (audiences.length > 1 && claims['azp'] !== expectedAudience) return denied('Untrusted OIDC audience', 'invalid_audience');
  return undefined;
}

function asAttribute(value: unknown): string | undefined {
  if (typeof value === 'string') return value.length === 0 ? undefined : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string')) return (value as string[]).join(',');
  return undefined;
}

const firstString = (...values: readonly unknown[]): string | undefined =>
  values.find((value): value is string => typeof value === 'string' && value.length > 0);

const decode = (value: string): string => Buffer.from(value, 'base64url').toString('utf8');

const denied = (message: string, reasonCode: string): Result<never> => ({
  ok: false,
  error: { code: 'PERMISSION_DENIED', message, details: { reasonCode } },
});
