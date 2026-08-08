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
const LABORATORY_ROLE = 'deliberation_laboratory_runtime';

suite('API persistence is tenant-isolated end to end', () => {
  let api: ApiProcess;
  let pool: pg.Pool;
  const writerTenantId = randomUUID();
  const otherTenantId = randomUUID();
  let deliberationId = '';

  const authorize = (tenantId: string): Record<string, string> => ({
    authorization: `Bearer ${mintToken(trusted.privateKeyPem, identityClaims(tenantId))}`,
  });

  /**
   * Reads exactly as the request path does: downgraded to the least-privilege runtime role, so
   * that FORCE ROW LEVEL SECURITY actually binds. Connecting as the superuser these tests use
   * would silently bypass every policy under test.
   */
  async function asRuntimeRole<T>(
    tenantId: string | undefined,
    run: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE ${LABORATORY_ROLE}`);
      if (tenantId !== undefined) await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      return await run(client);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl });
    api = await startApi({
      NODE_ENV: 'production',
      DATABASE_URL: databaseUrl ?? '',
      IDENTITY_AUDIENCE: AUDIENCE,
      IDENTITY_TRUSTED_ISSUERS: trustedIssuersConfig(trusted.publicKeyPem),
    });
    const created = await postRun(api.baseUrl, authorize(writerTenantId), laboratoryRequestBody(writerTenantId));
    expect(created.status).toBe(201);
    deliberationId = String(created.body['deliberationId']);
  }, 90_000);

  afterAll(async () => {
    await api?.stop();
    await pool?.end();
  });

  it('persists the accepted run to Postgres under the authenticated tenant', async () => {
    const rows = await asRuntimeRole(writerTenantId, async (client) => {
      const result = await client.query<{ aggregate_type: string }>(
        'SELECT aggregate_type FROM deliberation.aggregates WHERE tenant_id = $1 AND aggregate_id = $2',
        [writerTenantId, deliberationId],
      );
      return result.rows;
    });
    expect(rows).toEqual([{ aggregate_type: 'deliberation_case' }]);
  });

  it('commits the composed scenario, evaluation and outbox records in the same transaction', async () => {
    const counts = await asRuntimeRole(writerTenantId, async (client) => {
      const scenarios = await client.query('SELECT 1 FROM scenario_planning.aggregates WHERE tenant_id = $1', [writerTenantId]);
      const evaluations = await client.query('SELECT 1 FROM evaluation.aggregates WHERE tenant_id = $1', [writerTenantId]);
      const outbox = await client.query<{ event_type: string }>(
        'SELECT event_type FROM deliberation.outbox WHERE tenant_id = $1', [writerTenantId],
      );
      return {
        scenarios: scenarios.rowCount,
        evaluations: evaluations.rowCount,
        outbox: outbox.rows.map((row) => row.event_type),
      };
    });
    expect(counts).toEqual({
      scenarios: 1,
      evaluations: 2,
      outbox: ['deliberation.laboratory_run.completed'],
    });
  });

  it('denies a cross-tenant read of the persisted run', async () => {
    const rows = await asRuntimeRole(otherTenantId, async (client) => {
      const result = await client.query('SELECT tenant_id FROM deliberation.aggregates WHERE aggregate_id = $1', [deliberationId]);
      return result.rows;
    });
    expect(rows).toEqual([]);
  });

  it('fails closed rather than open when no tenant context is set at all', async () => {
    const rows = await asRuntimeRole(undefined, async (client) => {
      const result = await client.query('SELECT tenant_id FROM deliberation.aggregates');
      return result.rows;
    });
    expect(rows).toEqual([]);
  });

  it('denies a cross-tenant insert under the runtime role', async () => {
    await expect(asRuntimeRole(otherTenantId, async (client) => client.query(`
      INSERT INTO deliberation.aggregates
        (tenant_id, aggregate_type, aggregate_id, version, state, classification, retention_policy_id, created_at, updated_at)
      VALUES ($1, 'deliberation_case', $2, 1, '{}', 'confidential', 'r', now(), now())
    `, [writerTenantId, randomUUID()]))).rejects.toThrow();
  });

  it('contains the laboratory role to the schemas its composition actually touches', async () => {
    await expect(asRuntimeRole(writerTenantId, async (client) =>
      client.query('SELECT * FROM identity_access.aggregates'))).rejects.toThrow(/permission denied/i);
  });
});
