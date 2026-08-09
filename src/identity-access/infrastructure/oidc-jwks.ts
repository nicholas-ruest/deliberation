import { constants, createPublicKey, verify, type KeyObject } from 'node:crypto';
import type { Result } from '../../shared/domain/result.js';

/**
 * JWS algorithms this platform accepts on a federated OIDC ID token, and how each one has to be
 * handed to node:crypto. Anything absent here is refused before a key is even looked up, so
 * `alg: none` and HMAC algorithms (whose "public" key is the shared secret) can never be reached.
 */
const ALGORITHMS: Readonly<Record<string, { readonly kty: string; readonly hash: string | null; readonly padding?: number; readonly dsaEncoding?: 'ieee-p1363' }>> = {
  RS256: { kty: 'RSA', hash: 'sha256' },
  RS384: { kty: 'RSA', hash: 'sha384' },
  RS512: { kty: 'RSA', hash: 'sha512' },
  PS256: { kty: 'RSA', hash: 'sha256', padding: constants.RSA_PKCS1_PSS_PADDING },
  PS384: { kty: 'RSA', hash: 'sha384', padding: constants.RSA_PKCS1_PSS_PADDING },
  PS512: { kty: 'RSA', hash: 'sha512', padding: constants.RSA_PKCS1_PSS_PADDING },
  ES256: { kty: 'EC', hash: 'sha256', dsaEncoding: 'ieee-p1363' },
  ES384: { kty: 'EC', hash: 'sha384', dsaEncoding: 'ieee-p1363' },
  ES512: { kty: 'EC', hash: 'sha512', dsaEncoding: 'ieee-p1363' },
  EdDSA: { kty: 'OKP', hash: null },
};

export const SUPPORTED_JWS_ALGORITHMS: readonly string[] = Object.keys(ALGORITHMS);

export interface SigningKey {
  readonly kid: string;
  readonly kty: string;
  readonly alg?: string;
  readonly key: KeyObject;
}

export interface JwksKeySourceOptions {
  /** Skips OIDC discovery when the adopter's provider publishes its JWKS at a fixed URL. */
  readonly jwksUri?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly cacheTtlMs?: number;
  /**
   * Floor between forced refreshes. A token signed with an unseen `kid` is the normal signal that
   * the issuer rotated its keys, so an unknown kid triggers an immediate refetch — but only once
   * per interval, or a stream of tokens carrying bogus kids becomes a request amplifier pointed at
   * the issuer.
   */
  readonly minRefreshIntervalMs?: number;
  readonly requestTimeoutMs?: number;
}

/**
 * Fetches and caches an OIDC issuer's JWKS, refetching when a token arrives signed by a key the
 * cache has not seen. Discovery and JWKS documents are fetched from the issuer named in the
 * adapter's configuration and the discovery document's own `issuer` must agree with it, so a
 * substituted discovery response cannot redirect key lookup to an attacker-controlled JWKS.
 */
export class JwksKeySource {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly cacheTtlMs: number;
  private readonly minRefreshIntervalMs: number;
  private readonly requestTimeoutMs: number;
  private keys = new Map<string, SigningKey>();
  private fetchedAtMs = Number.NEGATIVE_INFINITY;
  private discoveredJwksUri: string | undefined;
  private inflight: Promise<Result<void>> | undefined;

  constructor(
    private readonly issuer: string,
    private readonly options: JwksKeySourceOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.cacheTtlMs = options.cacheTtlMs ?? 300_000;
    this.minRefreshIntervalMs = options.minRefreshIntervalMs ?? 30_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 5_000;
    this.discoveredJwksUri = options.jwksUri;
  }

  async keyFor(kid: string, nowMs: number): Promise<Result<SigningKey>> {
    if (nowMs - this.fetchedAtMs >= this.cacheTtlMs) {
      const refreshed = await this.refresh(nowMs);
      if (!refreshed.ok) return refreshed;
    }
    const cached = this.keys.get(kid);
    if (cached !== undefined) return { ok: true, value: cached };

    if (nowMs - this.fetchedAtMs >= this.minRefreshIntervalMs) {
      const rotated = await this.refresh(nowMs);
      if (!rotated.ok) return rotated;
      const rotatedKey = this.keys.get(kid);
      if (rotatedKey !== undefined) return { ok: true, value: rotatedKey };
    }
    return {
      ok: false,
      error: { code: 'PERMISSION_DENIED', message: 'Unknown federation signing key', details: { reasonCode: 'unknown_signing_key' } },
    };
  }

  private async refresh(nowMs: number): Promise<Result<void>> {
    // Collapses concurrent misses into one request rather than one per in-flight assertion.
    this.inflight ??= this.refreshOnce(nowMs).finally(() => { this.inflight = undefined; });
    return this.inflight;
  }

  private async refreshOnce(nowMs: number): Promise<Result<void>> {
    const jwksUri = this.discoveredJwksUri ?? await this.discoverJwksUri();
    if (typeof jwksUri !== 'string') return jwksUri;

    const document = await this.getJson(jwksUri);
    if (!document.ok) return document;
    const keys = (document.value as { keys?: unknown }).keys;
    if (!Array.isArray(keys)) return unavailable('Federation JWKS document has no keys');

    const parsed = new Map<string, SigningKey>();
    for (const candidate of keys) {
      const jwk = candidate as Record<string, unknown>;
      const { kid, kty, alg, use } = jwk;
      if (typeof kid !== 'string' || typeof kty !== 'string') continue;
      // `use: enc` keys are published for encryption; accepting one for signatures would let a key
      // the issuer never intended as a signing key authenticate an assertion.
      if (use !== undefined && use !== 'sig') continue;
      try {
        parsed.set(kid, {
          kid,
          kty,
          key: createPublicKey({ key: jwk, format: 'jwk' }),
          ...(typeof alg === 'string' ? { alg } : {}),
        });
      } catch { /* an unusable key must not discard the rest of the set */ }
    }
    if (parsed.size === 0) return unavailable('Federation JWKS document contains no usable signing keys');

    this.discoveredJwksUri = jwksUri;
    this.keys = parsed;
    this.fetchedAtMs = nowMs;
    return { ok: true, value: undefined };
  }

  private async discoverJwksUri(): Promise<string | Result<never>> {
    const base = this.issuer.endsWith('/') ? this.issuer.slice(0, -1) : this.issuer;
    const document = await this.getJson(`${base}/.well-known/openid-configuration`);
    if (!document.ok) return document;
    const { issuer, jwks_uri: jwksUri } = document.value as { issuer?: unknown; jwks_uri?: unknown };
    if (issuer !== this.issuer) return unavailable('Federation discovery document issuer does not match the configured issuer');
    if (typeof jwksUri !== 'string' || jwksUri.length === 0) return unavailable('Federation discovery document has no jwks_uri');
    return jwksUri;
  }

  private async getJson(url: string): Promise<Result<unknown>> {
    try {
      const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.requestTimeoutMs), redirect: 'error' });
      if (!response.ok) return unavailable(`Federation metadata request failed with status ${response.status}`);
      return { ok: true, value: await response.json() };
    } catch (cause) {
      return unavailable(`Federation metadata request failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
}

/**
 * Verifies a JWS signature with the algorithm the header declares, after confirming the key type
 * — and the key's own declared `alg`, when it publishes one — actually matches it. Without that
 * cross-check an issuer's RSA key could be presented against an EC algorithm, which is the classic
 * algorithm-confusion substitution.
 */
export function verifyJwsSignature(alg: string, signingInput: Buffer, signature: Buffer, signingKey: SigningKey): boolean {
  const spec = ALGORITHMS[alg];
  if (spec === undefined || spec.kty !== signingKey.kty) return false;
  if (signingKey.alg !== undefined && signingKey.alg !== alg) return false;
  if (spec.hash === null) return verify(null, signingInput, signingKey.key, signature);
  return verify(spec.hash, signingInput, {
    key: signingKey.key,
    ...(spec.padding === undefined ? {} : { padding: spec.padding, saltLength: constants.RSA_PSS_SALTLEN_DIGEST }),
    ...(spec.dsaEncoding === undefined ? {} : { dsaEncoding: spec.dsaEncoding }),
  }, signature);
}

const unavailable = (message: string): Result<never> => ({
  ok: false,
  error: { code: 'DEPENDENCY_UNAVAILABLE', message, retryable: true, details: { reasonCode: 'jwks_unavailable' } },
});
