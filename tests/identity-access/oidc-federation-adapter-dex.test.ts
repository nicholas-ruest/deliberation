import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OidcFederationAdapter } from '../../src/identity-access/infrastructure/index.js';

/**
 * ADR-050: the real-IdP contract test. Unlike `oidc-federation-adapter.test.ts`, which proves the
 * adapter's own logic against a hand-built fake issuer, this file runs a real Dex OIDC provider
 * (`tests/fixtures/oidc/dex-test-config.yaml`) in a throwaway container, drives the Resource Owner
 * Password Grant to obtain a real, Dex-key-signed ID token, and validates it with the unmodified
 * adapter — real discovery document, real JWKS, real signature.
 *
 * Gated like the `TEST_DATABASE_URL` suites: opt in with `OIDC_LIVE_IDP_CONTRACT=1` and a working
 * Docker daemon. Without either it skips cleanly rather than failing.
 */
const optedIn = process.env['OIDC_LIVE_IDP_CONTRACT'] !== undefined;

const dockerAvailable = ((): boolean => {
  if (!optedIn) return false;
  try {
    execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
})();

const suite = optedIn && dockerAvailable ? describe : describe.skip;

const IMAGE = 'dexidp/dex:v2.41.1';
/** The fixture pins `issuer: http://127.0.0.1:5556/dex`, so the container's port mapping must match it exactly. */
const ISSUER = 'http://127.0.0.1:5556/dex';
const CONFIG_PATH = fileURLToPath(new URL('../fixtures/oidc/dex-test-config.yaml', import.meta.url));
const PASSWORD_USERNAME = 'federation-user@deliberation.test';
const PASSWORD_SECRET = 'dex-test-only-password';

const run = (command: string, args: readonly string[]): string =>
  execFileSync(command, [...args], { stdio: 'pipe', encoding: 'utf8' });

async function passwordGrantToken(clientId: string, clientSecret: string): Promise<string> {
  const basic = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');
  const response = await fetch(`${ISSUER}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${basic}` },
    body: new URLSearchParams({
      grant_type: 'password',
      username: PASSWORD_USERNAME,
      password: PASSWORD_SECRET,
      scope: 'openid profile email',
    }),
  });
  if (!response.ok) throw new Error(`Dex token request failed: ${response.status} ${await response.text()}`);
  const body = (await response.json()) as { id_token?: unknown };
  if (typeof body.id_token !== 'string') throw new Error('Dex token response carried no id_token');
  return body.id_token;
}

let container = '';

suite('OidcFederationAdapter against a real Dex issuer (ADR-050)', () => {
  beforeAll(async () => {
    container = `oidc-dex-contract-${randomUUID().slice(0, 8)}`;
    run('docker', [
      'run', '--detach', '--name', container,
      '--publish', '127.0.0.1:5556:5556',
      '--volume', `${CONFIG_PATH}:/etc/dex/config.yaml:ro`,
      IMAGE, 'dex', 'serve', '/etc/dex/config.yaml',
    ]);

    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const probe = await fetch(`${ISSUER}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(2_000) });
        if (probe.status === 200) return;
      } catch { /* still starting */ }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new Error(`Dex container never became ready:\n${run('docker', ['logs', container])}`);
  }, 120_000);

  afterAll(() => {
    if (container === '') return;
    try { run('docker', ['rm', '--force', container]); } catch { /* already gone */ }
  });

  it('validates a real, Dex-signed ID token end to end through OIDC discovery and JWKS', async () => {
    const idToken = await passwordGrantToken('deliberation-federation-test', 'dex-test-only-client-secret');
    const adapter = new OidcFederationAdapter({
      provider: 'dex-test',
      issuer: ISSUER,
      allowInsecureIssuerTransport: true,
      displayAttributeClaims: ['email', 'email_verified', 'name'],
    });

    const result = await adapter.validate(idToken, 'deliberation-federation-test', new Date());

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.provider).toBe('dex-test');
    expect(result.ok && result.value.issuer).toBe(ISSUER);
    expect(result.ok && result.value.subject.length > 0).toBe(true);
    expect(result.ok && result.value.displayAttributes).toStrictEqual({
      email: PASSWORD_USERNAME,
      email_verified: 'true',
      name: 'federation-user',
    });
  });

  it('rejects a real token minted for a different registered client as an unaddressed audience', async () => {
    const idToken = await passwordGrantToken('deliberation-federation-other-audience', 'dex-test-only-other-client-secret');
    const adapter = new OidcFederationAdapter({ provider: 'dex-test', issuer: ISSUER, allowInsecureIssuerTransport: true });

    const result = await adapter.validate(idToken, 'deliberation-federation-test', new Date());

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.details?.['reasonCode']).toBe('invalid_audience');
  });

  it('rejects a token whose header names a key Dex never published, proving JWKS comes from the real issuer', async () => {
    const idToken = await passwordGrantToken('deliberation-federation-test', 'dex-test-only-client-secret');
    const [, payload, signature] = idToken.split('.');
    const forgedHeader = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'not-a-real-dex-key' }), 'utf8').toString('base64url');
    const adapter = new OidcFederationAdapter({ provider: 'dex-test', issuer: ISSUER, allowInsecureIssuerTransport: true });

    const result = await adapter.validate(`${forgedHeader}.${payload}.${signature}`, 'deliberation-federation-test', new Date());

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.details?.['reasonCode']).toBe('unknown_signing_key');
  });
});
