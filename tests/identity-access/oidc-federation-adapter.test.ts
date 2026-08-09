import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { generateKeyPairSync, type KeyObject, sign } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  InvalidOidcFederationConfigError,
  JwksKeySource,
  OidcFederationAdapter,
} from '../../src/identity-access/infrastructure/index.js';
import type { ReplayStore } from '../../src/platform/security/trusted-identity.js';

interface TestKey {
  readonly kid: string;
  readonly alg: string;
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
}

const rsa = (kid: string): TestKey => ({ kid, alg: 'RS256', ...generateKeyPairSync('rsa', { modulusLength: 2048 }) });
const ec = (kid: string): TestKey => ({ kid, alg: 'ES256', ...generateKeyPairSync('ec', { namedCurve: 'P-256' }) });
const ed = (kid: string): TestKey => ({ kid, alg: 'EdDSA', ...generateKeyPairSync('ed25519') });

function jwk(key: TestKey): Record<string, unknown> {
  return { ...key.publicKey.export({ format: 'jwk' }), kid: key.kid, use: 'sig', alg: key.alg };
}

function signAssertion(key: TestKey, claims: Record<string, unknown>, header: Record<string, unknown> = {}): string {
  const encodedHeader = encode({ alg: key.alg, kid: key.kid, ...header });
  const encodedPayload = encode(claims);
  const input = Buffer.from(`${encodedHeader}.${encodedPayload}`, 'ascii');
  const signature = key.alg === 'EdDSA'
    ? sign(null, input, key.privateKey)
    : key.alg === 'ES256'
      ? sign('sha256', input, { key: key.privateKey, dsaEncoding: 'ieee-p1363' })
      : sign('sha256', input, key.privateKey);
  return `${encodedHeader}.${encodedPayload}.${signature.toString('base64url')}`;
}

const encode = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

/** Stands in for the issuer's metadata endpoints only — every token in this suite is signed with a real key. */
class FakeIssuerEndpoints {
  private server: Server | undefined;
  issuer = '';
  published: readonly TestKey[] = [];
  /** Set to publish a JWKS body verbatim, for key entries no real key pair can produce. */
  publishedRaw: readonly unknown[] | undefined;
  requests: string[] = [];

  async start(keys: readonly TestKey[]): Promise<void> {
    this.published = keys;
    this.server = createServer((request, response) => {
      this.requests.push(request.url ?? '');
      const body = request.url === '/.well-known/openid-configuration'
        ? { issuer: this.issuer, jwks_uri: `${this.issuer}/keys` }
        : request.url === '/keys'
          ? { keys: this.published.map(jwk) }
          : undefined;
      response.writeHead(body === undefined ? 404 : 200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body ?? { error: 'not_found' }));
    });
    await new Promise<void>((resolve) => this.server?.listen(0, '127.0.0.1', resolve));
    this.issuer = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => { this.server?.close(() => { resolve(); }); });
  }
}

const AUDIENCE = 'deliberation-api';
const signingKey = rsa('key-1');
const rotatedKey = rsa('key-2');
const issuerEndpoints = new FakeIssuerEndpoints();

const validClaims = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  iss: issuerEndpoints.issuer,
  sub: 'CiQ2ZTFmOGI2Mg',
  aud: AUDIENCE,
  exp: 1_800_000_300,
  iat: 1_800_000_000,
  email: 'federation-user@deliberation.test',
  email_verified: true,
  groups: ['platform-operators', 'reviewers'],
  ...overrides,
});

const NOW = new Date(1_800_000_100_000);

function adapter(overrides: Record<string, unknown> = {}, options: Record<string, unknown> = {}): OidcFederationAdapter {
  return new OidcFederationAdapter(
    { provider: 'test-idp', issuer: issuerEndpoints.issuer, allowInsecureIssuerTransport: true, ...overrides },
    { minRefreshIntervalMs: 0, ...options },
  );
}

beforeAll(async () => { await issuerEndpoints.start([signingKey]); });
afterAll(async () => { await issuerEndpoints.stop(); });

describe('OidcFederationAdapter configuration (ADR-050)', () => {
  it('refuses a plaintext issuer unless the transport escape hatch is explicit', () => {
    expect(() => new OidcFederationAdapter({ provider: 'p', issuer: 'http://idp.test' }))
      .toThrow(InvalidOidcFederationConfigError);
    expect(() => new OidcFederationAdapter({ provider: 'p', issuer: 'https://idp.test' })).not.toThrow();
  });

  it('refuses an algorithm allowlist this adapter cannot verify', () => {
    expect(() => new OidcFederationAdapter({ provider: 'p', issuer: 'https://idp.test', allowedAlgorithms: ['HS256'] }))
      .toThrow(InvalidOidcFederationConfigError);
    expect(() => new OidcFederationAdapter({ provider: 'p', issuer: 'https://idp.test', allowedAlgorithms: [] }))
      .toThrow(InvalidOidcFederationConfigError);
  });

  it('refuses an empty provider or issuer', () => {
    expect(() => new OidcFederationAdapter({ provider: '', issuer: 'https://idp.test' })).toThrow(InvalidOidcFederationConfigError);
  });
});

describe('OidcFederationAdapter claim mapping (ADR-050)', () => {
  it('maps sub, iss and the configured tenant-hint and display claims', async () => {
    const result = await adapter({ tenantHintClaim: 'groups', displayAttributeClaims: ['email', 'email_verified'] })
      .validate(signAssertion(signingKey, validClaims()), AUDIENCE, NOW);

    expect(result).toStrictEqual({
      ok: true,
      value: {
        provider: 'test-idp',
        issuer: issuerEndpoints.issuer,
        subject: 'CiQ2ZTFmOGI2Mg',
        tenantHint: 'platform-operators,reviewers',
        displayAttributes: { email: 'federation-user@deliberation.test', email_verified: 'true' },
      },
    });
  });

  it('omits the tenant hint when the configured claim is absent', async () => {
    const result = await adapter({ tenantHintClaim: 'org_id' })
      .validate(signAssertion(signingKey, validClaims()), AUDIENCE, NOW);

    expect(result.ok).toBe(true);
    expect(result.ok && 'tenantHint' in result.value).toBe(false);
  });

  it('carries across only the claims the adapter is configured to expose', async () => {
    const result = await adapter({ displayAttributeClaims: ['email'] })
      .validate(signAssertion(signingKey, validClaims({ ssn: '000-00-0000' })), AUDIENCE, NOW);

    expect(result.ok && result.value.displayAttributes).toStrictEqual({ email: 'federation-user@deliberation.test' });
  });

  it('declares the oidc protocol', () => {
    expect(adapter().protocol).toBe('oidc');
  });
});

describe('OidcFederationAdapter rejection paths (ADR-050)', () => {
  const reason = async (assertion: string, audience = AUDIENCE, now = NOW, config = {}): Promise<string | undefined> => {
    const result = await adapter(config).validate(assertion, audience, now);
    return result.ok ? undefined : (result.error.details?.['reasonCode'] as string | undefined);
  };

  it('rejects a structurally malformed assertion', async () => {
    expect(await reason('not-a-jwt')).toBe('malformed_assertion');
    expect(await reason('a.b.c.d')).toBe('malformed_assertion');
    expect(await reason(`${Buffer.from('{').toString('base64url')}.e30.x`)).toBe('malformed_assertion');
  });

  it('rejects an unsigned or unsupported-algorithm assertion', async () => {
    const claims = encode(validClaims());
    expect(await reason(`${encode({ alg: 'none' })}.${claims}.`)).toBe('unsupported_algorithm');
    expect(await reason(`${encode({ alg: 'HS256', kid: 'key-1' })}.${claims}.AAAA`)).toBe('unsupported_algorithm');
    expect(await reason(`${encode({ alg: 'RS256' })}.${claims}.AAAA`)).toBe('unsupported_algorithm');
    expect(await reason(signAssertion(signingKey, validClaims(), { crit: ['x'] }))).toBe('unsupported_algorithm');
    expect(await reason(signAssertion(signingKey, validClaims(), { typ: 'at+jwt' }))).toBe('unsupported_algorithm');
  });

  it('rejects an algorithm outside the configured allowlist even when the signature is real', async () => {
    expect(await reason(signAssertion(signingKey, validClaims()), AUDIENCE, NOW, { allowedAlgorithms: ['ES256'] }))
      .toBe('unsupported_algorithm');
  });

  it('rejects another issuer', async () => {
    expect(await reason(signAssertion(signingKey, validClaims({ iss: 'https://evil.test' })))).toBe('untrusted_issuer');
  });

  it('rejects a wrong, missing, or unaddressed audience', async () => {
    expect(await reason(signAssertion(signingKey, validClaims({ aud: 'other-api' })))).toBe('invalid_audience');
    expect(await reason(signAssertion(signingKey, validClaims({ aud: undefined })))).toBe('invalid_audience');
    expect(await reason(signAssertion(signingKey, validClaims({ aud: [AUDIENCE, 1] })))).toBe('invalid_audience');
    // Present in `aud` but authorized to a different party.
    expect(await reason(signAssertion(signingKey, validClaims({ aud: [AUDIENCE, 'other-api'], azp: 'other-api' }))))
      .toBe('invalid_audience');
    expect((await adapter().validate(signAssertion(signingKey, validClaims({ aud: [AUDIENCE, 'other'], azp: AUDIENCE })), AUDIENCE, NOW)).ok)
      .toBe(true);
  });

  it('rejects a tampered payload', async () => {
    const assertion = signAssertion(signingKey, validClaims());
    const [header, , signature] = assertion.split('.');
    expect(await reason(`${header}.${encode(validClaims({ sub: 'someone-else' }))}.${signature}`)).toBe('invalid_signature');
  });

  it('rejects an assertion signed by a key the issuer does not publish', async () => {
    expect(await reason(signAssertion({ ...rsa('key-1'), kid: 'key-1' }, validClaims()))).toBe('invalid_signature');
    expect(await reason(signAssertion(rsa('never-published'), validClaims()))).toBe('unknown_signing_key');
  });

  it('rejects an expired assertion and one issued in the future, allowing configured skew', async () => {
    expect(await reason(signAssertion(signingKey, validClaims()), AUDIENCE, new Date(1_800_000_400_000))).toBe('invalid_claims');
    expect(await reason(signAssertion(signingKey, validClaims()), AUDIENCE, new Date(1_799_990_000_000))).toBe('invalid_claims');
    // 20s past expiry is inside the default 60s skew allowance.
    expect(await reason(signAssertion(signingKey, validClaims()), AUDIENCE, new Date(1_800_000_320_000))).toBeUndefined();
  });

  it('rejects missing, malformed, or over-long-lived lifetime claims', async () => {
    expect(await reason(signAssertion(signingKey, validClaims({ exp: undefined })))).toBe('invalid_claims');
    expect(await reason(signAssertion(signingKey, validClaims({ iat: undefined })))).toBe('invalid_claims');
    expect(await reason(signAssertion(signingKey, validClaims({ exp: '1800000300' })))).toBe('invalid_claims');
    expect(await reason(signAssertion(signingKey, validClaims({ sub: undefined })))).toBe('invalid_claims');
    expect(await reason(signAssertion(signingKey, validClaims({ nbf: 1_800_000_299 })))).toBe('invalid_claims');
    expect(await reason(signAssertion(signingKey, validClaims({ exp: 1_800_000_300, iat: 1_700_000_000 })))).toBe('invalid_claims');
  });

  it('reports the issuer as unavailable rather than denied when its metadata cannot be read', async () => {
    const unreachable = new OidcFederationAdapter(
      { provider: 'p', issuer: 'http://127.0.0.1:1', allowInsecureIssuerTransport: true },
      { requestTimeoutMs: 250 },
    );
    const result = await unreachable.validate(signAssertion(signingKey, validClaims({ iss: 'http://127.0.0.1:1' })), AUDIENCE, NOW);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('DEPENDENCY_UNAVAILABLE');
  });

  it('refuses a discovery document that claims a different issuer', async () => {
    const impostor = new FakeIssuerEndpoints();
    await impostor.start([signingKey]);
    const real = impostor.issuer;
    impostor.issuer = 'https://somewhere-else.test';
    const result = await new OidcFederationAdapter(
      { provider: 'p', issuer: real, allowInsecureIssuerTransport: true },
    ).validate(signAssertion(signingKey, validClaims({ iss: real })), AUDIENCE, NOW);
    expect(!result.ok && result.error.details?.['reasonCode']).toBe('jwks_unavailable');
    await impostor.stop();
  });
});

describe('OidcFederationAdapter JWKS caching and rotation (ADR-050)', () => {
  it('fetches the key set once and reuses it across assertions', async () => {
    const endpoints = new FakeIssuerEndpoints();
    await endpoints.start([signingKey]);
    const cached = new OidcFederationAdapter({ provider: 'p', issuer: endpoints.issuer, allowInsecureIssuerTransport: true });
    const claims = { ...validClaims(), iss: endpoints.issuer };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await cached.validate(signAssertion(signingKey, claims), AUDIENCE, NOW)).ok).toBe(true);
    }
    expect(endpoints.requests).toStrictEqual(['/.well-known/openid-configuration', '/keys']);
    await endpoints.stop();
  });

  it('refetches when the issuer rotates to a key the cache has not seen', async () => {
    const endpoints = new FakeIssuerEndpoints();
    await endpoints.start([signingKey]);
    const rotating = new OidcFederationAdapter(
      { provider: 'p', issuer: endpoints.issuer, allowInsecureIssuerTransport: true },
      { minRefreshIntervalMs: 0 },
    );
    const claims = { ...validClaims(), iss: endpoints.issuer };
    expect((await rotating.validate(signAssertion(signingKey, claims), AUDIENCE, NOW)).ok).toBe(true);

    endpoints.published = [rotatedKey];
    expect((await rotating.validate(signAssertion(rotatedKey, claims), AUDIENCE, NOW)).ok).toBe(true);
    expect(endpoints.requests.filter((path) => path === '/keys').length).toBe(2);

    // The retired key is gone from the published set, so assertions it signed stop being accepted.
    const retired = await rotating.validate(signAssertion(signingKey, claims), AUDIENCE, NOW);
    expect(!retired.ok && retired.error.details?.['reasonCode']).toBe('unknown_signing_key');
    await endpoints.stop();
  });

  it('does not amplify unknown-kid traffic back at the issuer within the refresh floor', async () => {
    const endpoints = new FakeIssuerEndpoints();
    await endpoints.start([signingKey]);
    const throttled = new JwksKeySource(endpoints.issuer, { minRefreshIntervalMs: 60_000 });
    const nowMs = Date.now();
    expect((await throttled.keyFor(signingKey.kid, nowMs)).ok).toBe(true);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await throttled.keyFor('unknown', nowMs + attempt)).ok).toBe(false);
    }
    expect(endpoints.requests.filter((path) => path === '/keys').length).toBe(1);
    await endpoints.stop();
  });

  it('ignores encryption-only and unusable keys in the published set', async () => {
    const endpoints = new FakeIssuerEndpoints();
    await endpoints.start([]);
    endpoints.published = [];
    const encryptionOnly = rsa('enc-key');
    const server = new JwksKeySource(endpoints.issuer, {});
    endpoints.published = [{ ...encryptionOnly }];
    // Publish it as an encryption key and as a structurally broken entry alongside a real one.
    const original = endpoints.published.map(jwk);
    const patched = [{ ...original[0], use: 'enc' }, { kid: 'broken', kty: 'RSA' }, jwk(signingKey)];
    endpoints.published = patched as unknown as readonly TestKey[];
    Object.defineProperty(endpoints, 'published', { value: patched, writable: true });
    const source = new JwksKeySource(endpoints.issuer, { jwksUri: `${endpoints.issuer}/keys` });
    void server;

    endpoints.published = { map: () => patched } as unknown as readonly TestKey[];
    expect((await source.keyFor('enc-key', Date.now())).ok).toBe(false);
    expect((await source.keyFor('broken', Date.now())).ok).toBe(false);
    expect((await source.keyFor(signingKey.kid, Date.now())).ok).toBe(true);
    await endpoints.stop();
  });
});

describe('OidcFederationAdapter algorithm coverage and single use (ADR-050)', () => {
  it('verifies EC and Ed25519 signatures as well as RSA', async () => {
    const ecKey = ec('ec-key');
    const edKey = ed('ed-key');
    const endpoints = new FakeIssuerEndpoints();
    await endpoints.start([ecKey, edKey]);
    const multi = new OidcFederationAdapter({ provider: 'p', issuer: endpoints.issuer, allowInsecureIssuerTransport: true });
    const claims = { ...validClaims(), iss: endpoints.issuer };

    expect((await multi.validate(signAssertion(ecKey, claims), AUDIENCE, NOW)).ok).toBe(true);
    expect((await multi.validate(signAssertion(edKey, claims), AUDIENCE, NOW)).ok).toBe(true);
    await endpoints.stop();
  });

  it('rejects an assertion whose header algorithm does not match the published key', async () => {
    const ecKey = ec('ec-key');
    const endpoints = new FakeIssuerEndpoints();
    await endpoints.start([ecKey]);
    const confused = new OidcFederationAdapter({ provider: 'p', issuer: endpoints.issuer, allowInsecureIssuerTransport: true });
    const assertion = signAssertion({ ...ecKey, alg: 'ES256' }, { ...validClaims(), iss: endpoints.issuer });
    const [, payload, signature] = assertion.split('.');
    const swapped = `${encode({ alg: 'RS256', kid: 'ec-key' })}.${payload}.${signature}`;

    const result = await confused.validate(swapped, AUDIENCE, NOW);
    expect(!result.ok && result.error.details?.['reasonCode']).toBe('invalid_signature');
    await endpoints.stop();
  });

  it('consumes each assertion once when a replay store is wired', async () => {
    const consumed = new Set<string>();
    const replay: ReplayStore = { consume: async (id) => (consumed.has(id) ? false : (consumed.add(id), true)) };
    const single = adapter({}, { replay });
    const assertion = signAssertion(signingKey, validClaims({ nonce: 'n-1' }));

    expect((await single.validate(assertion, AUDIENCE, NOW)).ok).toBe(true);
    const second = await single.validate(assertion, AUDIENCE, NOW);
    expect(!second.ok && second.error.details?.['reasonCode']).toBe('replayed_assertion');

    const noNonce = await single.validate(signAssertion(signingKey, validClaims()), AUDIENCE, NOW);
    expect(!noNonce.ok && noNonce.error.details?.['reasonCode']).toBe('missing_replay_identifier');
  });
});
