import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AUDIENCE,
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

suite('API rate-limits an authenticated principal (ADR-034 item 3)', () => {
  let api: ApiProcess;

  beforeAll(async () => {
    api = await startApi({
      NODE_ENV: 'production',
      DATABASE_URL: databaseUrl ?? '',
      IDENTITY_AUDIENCE: AUDIENCE,
      IDENTITY_TRUSTED_ISSUERS: trustedIssuersConfig(trusted.publicKeyPem),
      RATE_LIMIT_PER_PRINCIPAL_PER_MINUTE: '3',
    });
  }, 90_000);

  afterAll(async () => api?.stop());

  it('accepts requests under the ceiling and rejects with 429 once exceeded, independent of tenant isolation', async () => {
    const tenantId = randomUUID();
    const claims = identityClaims(tenantId);
    // Every request reuses the same (tenantId, principalId) bucket key but a fresh single-use
    // token, since replay protection (item 1) and rate limiting (item 3) are independent controls.
    const requestsUnderCeiling = 3;
    for (let index = 0; index < requestsUnderCeiling; index += 1) {
      const token = mintToken(trusted.privateKeyPem, { ...claims, jti: `${claims['jti']}-${index}` });
      const result = await postRun(api.baseUrl, { authorization: `Bearer ${token}` }, laboratoryRequestBody(tenantId));
      expect(result.status).toBe(201);
    }

    const overCeilingToken = mintToken(trusted.privateKeyPem, { ...claims, jti: `${claims['jti']}-over` });
    const limited = await postRun(api.baseUrl, { authorization: `Bearer ${overCeilingToken}` }, laboratoryRequestBody(tenantId));
    expect(limited.status).toBe(429);
    expect(limited.body['code']).toBe('RATE_LIMITED');
  }, 30_000);

  it('does not rate-limit a different principal sharing the same window', async () => {
    const firstTenantId = randomUUID();
    const secondTenantId = randomUUID();
    const firstClaims = identityClaims(firstTenantId);
    const secondClaims = identityClaims(secondTenantId);

    for (let index = 0; index < 3; index += 1) {
      const token = mintToken(trusted.privateKeyPem, { ...firstClaims, jti: `${firstClaims['jti']}-${index}` });
      await postRun(api.baseUrl, { authorization: `Bearer ${token}` }, laboratoryRequestBody(firstTenantId));
    }

    const secondPrincipalToken = mintToken(trusted.privateKeyPem, secondClaims);
    const result = await postRun(api.baseUrl, { authorization: `Bearer ${secondPrincipalToken}` }, laboratoryRequestBody(secondTenantId));
    expect(result.status).toBe(201);
  }, 30_000);
});
