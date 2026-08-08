import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AUDIENCE,
  TRUSTED_ISSUER,
  generateIssuerKeypair,
  identityClaims,
  laboratoryRequestBody,
  mintToken,
  postRun,
  startApi,
  trustedIssuersConfig,
  type ApiProcess,
} from './api-process-harness.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
const suite = databaseUrl === undefined ? describe.skip : describe;

const trusted = generateIssuerKeypair();
const untrusted = generateIssuerKeypair();

suite('API identity boundary is fail-closed', () => {
  let api: ApiProcess;

  beforeAll(async () => {
    // ALLOW_LOCAL_DOMAIN_DEMO is deliberately set *alongside* NODE_ENV=production: the whole
    // suite therefore doubles as proof that the header-trusting demo path cannot be re-enabled
    // by a single misconfigured variable.
    api = await startApi({
      NODE_ENV: 'production',
      ALLOW_LOCAL_DOMAIN_DEMO: 'true',
      DATABASE_URL: databaseUrl ?? '',
      IDENTITY_AUDIENCE: AUDIENCE,
      IDENTITY_TRUSTED_ISSUERS: trustedIssuersConfig(trusted.publicKeyPem),
    });
  }, 90_000);

  afterAll(async () => api?.stop());

  it('reports production integrations, not demo mode, when both are configured', async () => {
    const response = await fetch(`${api.baseUrl}/health/ready`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ready', mode: 'production-integrations' });
  });

  it('rejects a request with no authorization header', async () => {
    const tenantId = randomUUID();
    const result = await postRun(api.baseUrl, {}, laboratoryRequestBody(tenantId));
    expect(result.status).toBe(401);
    expect(result.body['code']).toBe('UNAUTHENTICATED');
  });

  it('does not trust client-supplied tenant/principal headers without a signed token', async () => {
    const tenantId = randomUUID();
    const result = await postRun(api.baseUrl, {
      'x-tenant-id': tenantId,
      'x-principal-id': 'attacker',
    }, laboratoryRequestBody(tenantId));
    expect(result.status).toBe(401);
    expect(result.body['code']).toBe('UNAUTHENTICATED');
  });

  it('rejects an authorization header that is not a bearer token', async () => {
    const tenantId = randomUUID();
    const result = await postRun(api.baseUrl, {
      authorization: `Basic ${Buffer.from('user:password').toString('base64')}`,
    }, laboratoryRequestBody(tenantId));
    expect(result.status).toBe(401);
  });

  it('rejects a malformed bearer token without leaking the reason to the client (ADR-034 item 7)', async () => {
    const tenantId = randomUUID();
    const result = await postRun(api.baseUrl, {
      authorization: 'Bearer not-a-token',
    }, laboratoryRequestBody(tenantId));
    expect(result.status).toBe(403);
    expect(result.body['code']).toBe('PERMISSION_DENIED');
    expect(result.body['detail']).toBeUndefined();
  });

  it('rejects a structurally valid token whose payload is garbage', async () => {
    const tenantId = randomUUID();
    const garbage = ['eyJhbGciOiJFZERTQSIsImtpZCI6InNlY3VyaXR5LXN1aXRlLWtleS0xIn0', 'bm90LWpzb24', 'AAAA'].join('.');
    const result = await postRun(api.baseUrl, { authorization: `Bearer ${garbage}` }, laboratoryRequestBody(tenantId));
    expect(result.status).toBe(403);
  });

  it('rejects a token minted for a different audience', async () => {
    const tenantId = randomUUID();
    const token = mintToken(trusted.privateKeyPem, identityClaims(tenantId, { aud: 'some-other-service' }));
    const result = await postRun(api.baseUrl, { authorization: `Bearer ${token}` }, laboratoryRequestBody(tenantId));
    expect(result.status).toBe(403);
    expect(result.body['code']).toBe('PERMISSION_DENIED');
  });

  it('rejects an expired token', async () => {
    const tenantId = randomUUID();
    const expiredAt = Math.floor(Date.now() / 1000) - 60;
    const token = mintToken(trusted.privateKeyPem, identityClaims(tenantId, { iat: expiredAt - 300, exp: expiredAt }));
    const result = await postRun(api.baseUrl, { authorization: `Bearer ${token}` }, laboratoryRequestBody(tenantId));
    expect(result.status).toBe(403);
    expect(result.body['detail']).toBeUndefined();
  });

  it('rejects a token signed by an untrusted key', async () => {
    const tenantId = randomUUID();
    const token = mintToken(untrusted.privateKeyPem, identityClaims(tenantId));
    const result = await postRun(api.baseUrl, { authorization: `Bearer ${token}` }, laboratoryRequestBody(tenantId));
    expect(result.status).toBe(403);
    expect(result.body['detail']).toBeUndefined();
  });

  it('rejects a token from an issuer that is not configured as trusted', async () => {
    const tenantId = randomUUID();
    const token = mintToken(untrusted.privateKeyPem, identityClaims(tenantId, { iss: 'https://attacker.invalid' }));
    const result = await postRun(api.baseUrl, { authorization: `Bearer ${token}` }, laboratoryRequestBody(tenantId));
    expect(result.status).toBe(403);
    expect(result.body['detail']).toBeUndefined();
  });

  it('rejects a token referencing an unknown key id from a trusted issuer', async () => {
    const tenantId = randomUUID();
    const token = mintToken(trusted.privateKeyPem, identityClaims(tenantId), 'rotated-away-key');
    const result = await postRun(api.baseUrl, { authorization: `Bearer ${token}` }, laboratoryRequestBody(tenantId));
    expect(result.status).toBe(403);
    expect(result.body['detail']).toBeUndefined();
  });

  it('rejects a token whose tenant claim differs from the requested tenant', async () => {
    const tokenTenantId = randomUUID();
    const bodyTenantId = randomUUID();
    const token = mintToken(trusted.privateKeyPem, identityClaims(tokenTenantId));
    const result = await postRun(api.baseUrl, { authorization: `Bearer ${token}` }, laboratoryRequestBody(bodyTenantId));
    expect(result.status).toBe(403);
    expect(result.body['code']).toBe('PERMISSION_DENIED');
  });

  it('refuses to replay an otherwise valid token a second time', async () => {
    const tenantId = randomUUID();
    const token = mintToken(trusted.privateKeyPem, identityClaims(tenantId));
    const headers = { authorization: `Bearer ${token}` };

    const first = await postRun(api.baseUrl, headers, laboratoryRequestBody(tenantId));
    expect(first.status).toBe(201);

    const replayed = await postRun(api.baseUrl, headers, laboratoryRequestBody(tenantId));
    expect(replayed.status).toBe(403);
    expect(replayed.body['detail']).toBeUndefined();
  });

  it('replay protection holds against a token first seen by a different process (multi-replica correctness, ADR-034 item 1)', async () => {
    // Simulates api-deployment.yaml's 3 replicas: two independently spawned api.ts processes
    // sharing the same Postgres, each with their own in-process TrustedIdentityVerifier state.
    // A MemoryReplayStore would not catch this; the PostgresReplayStore each process is wired to
    // in non-demo mode must.
    const secondReplica = await startApi({
      NODE_ENV: 'production',
      DATABASE_URL: process.env['TEST_DATABASE_URL'] ?? '',
      IDENTITY_AUDIENCE: AUDIENCE,
      IDENTITY_TRUSTED_ISSUERS: trustedIssuersConfig(trusted.publicKeyPem),
    });
    try {
      const tenantId = randomUUID();
      const token = mintToken(trusted.privateKeyPem, identityClaims(tenantId));
      const headers = { authorization: `Bearer ${token}` };

      const first = await postRun(api.baseUrl, headers, laboratoryRequestBody(tenantId));
      expect(first.status).toBe(201);

      const replayedAgainstOtherReplica = await postRun(secondReplica.baseUrl, headers, laboratoryRequestBody(tenantId));
      expect(replayedAgainstOtherReplica.status).toBe(403);
    } finally {
      await secondReplica.stop();
    }
  }, 30_000);

  it('accepts a correctly signed, single-use token from the trusted issuer', async () => {
    const tenantId = randomUUID();
    const claims = identityClaims(tenantId);
    const token = mintToken(trusted.privateKeyPem, claims);
    const result = await postRun(api.baseUrl, { authorization: `Bearer ${token}` }, laboratoryRequestBody(tenantId));
    expect(result.status).toBe(201);
    expect(result.body['state']).toBe('review');
    expect(claims['iss']).toBe(TRUSTED_ISSUER);
  });
});
