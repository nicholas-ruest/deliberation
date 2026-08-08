import { randomUUID } from 'node:crypto';
import pg from 'pg';
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
const SQL_METACHARACTERS = "'; DROP TABLE deliberation.aggregates; --";

suite('API rejects hostile payloads at the validation boundary', () => {
  let api: ApiProcess;
  let pool: pg.Pool;

  const authorize = (tenantId: string): Record<string, string> => ({
    authorization: `Bearer ${mintToken(trusted.privateKeyPem, identityClaims(tenantId))}`,
  });

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl });
    api = await startApi({
      NODE_ENV: 'production',
      DATABASE_URL: databaseUrl ?? '',
      IDENTITY_AUDIENCE: AUDIENCE,
      IDENTITY_TRUSTED_ISSUERS: trustedIssuersConfig(trusted.publicKeyPem),
    });
  }, 90_000);

  afterAll(async () => {
    await api?.stop();
    await pool?.end();
  });

  const rejectedPayloads: readonly (readonly [string, (tenantId: string) => Record<string, unknown>])[] = [
    ['a SQL statement where an array of options is expected', (tenantId) => ({
      ...laboratoryRequestBody(tenantId),
      contract: { ...laboratoryRequestBody(tenantId)['contract'] as object, options: SQL_METACHARACTERS },
    })],
    ['a SQL statement where a numeric criterion weight is expected', (tenantId) => ({
      ...laboratoryRequestBody(tenantId),
      criteria: [{ key: 'value', label: 'Value', unit: 'points', weight: '1 OR 1=1', state: 'confirmed' }],
    })],
    ['a number where a title string is expected', (tenantId) => ({ ...laboratoryRequestBody(tenantId), title: 12_345 })],
    ['a nested object where a policy version string is expected', (tenantId) => ({
      ...laboratoryRequestBody(tenantId),
      policyVersion: { $ne: null },
    })],
    ['an oversized string where a closed enum is expected', (tenantId) => ({
      ...laboratoryRequestBody(tenantId),
      criteria: [{ key: 'value', label: 'Value', unit: 'points', weight: 1, state: 'A'.repeat(200_000) }],
    })],
    ['an array past the upper bound, packed with small entries to burn CPU cheaply (ADR-034 item 2)', (tenantId) => ({
      ...laboratoryRequestBody(tenantId),
      findings: Array.from({ length: 201 }, (_, index) => ({
        id: `f${index}`, optionId: 'a', claimId: `c${index}`, kind: 'policy', status: 'pass',
        evidenceReferences: ['e'], verifierVersion: '1', rationale: 'r',
      })),
    })],
  ];

  for (const [description, build] of rejectedPayloads) {
    it(`rejects ${description} with a validation error, not a server error`, async () => {
      const tenantId = randomUUID();
      const result = await postRun(api.baseUrl, authorize(tenantId), build(tenantId));
      expect(result.status).toBe(400);
      expect(result.body['code']).toBe('INVALID_ARGUMENT');
    });
  }

  it('rejects a body that is not JSON at all', async () => {
    const tenantId = randomUUID();
    const result = await postRun(api.baseUrl, authorize(tenantId), `${SQL_METACHARACTERS}`);
    expect(result.status).toBe(400);
  });

  it('parameterizes a SQL-metacharacter tenant identifier instead of executing it', async () => {
    const hostileTenantId = `${randomUUID()}'; DROP TABLE deliberation.aggregates; --`;
    const token = mintToken(trusted.privateKeyPem, identityClaims(hostileTenantId));
    const result = await postRun(
      api.baseUrl,
      { authorization: `Bearer ${token}` },
      laboratoryRequestBody(hostileTenantId),
    );
    expect(result.status).toBe(400);

    const surviving = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM pg_tables WHERE schemaname = 'deliberation' AND tablename = 'aggregates'",
    );
    expect(surviving.rows.map((row) => row.count)).toEqual(['1']);
  });

  it('does not persist anything for a payload the boundary rejected', async () => {
    const tenantId = randomUUID();
    const result = await postRun(api.baseUrl, authorize(tenantId), {
      ...laboratoryRequestBody(tenantId),
      title: 12_345,
    });
    expect(result.status).toBe(400);

    const persisted = await pool.query('SELECT 1 FROM deliberation.aggregates WHERE tenant_id = $1', [tenantId]);
    expect(persisted.rowCount).toBe(0);
  });
});
