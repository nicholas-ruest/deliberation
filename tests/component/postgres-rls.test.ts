import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const databaseUrl = process.env['TEST_DATABASE_URL'];
const suite = databaseUrl === undefined ? describe.skip : describe;

suite('PostgreSQL tenant RLS component contract', () => {
  const pool = new pg.Pool({ connectionString: databaseUrl });

  beforeAll(async () => {
    await pool.query(`
      INSERT INTO identity_access.aggregates
        (tenant_id, aggregate_type, aggregate_id, version, state, classification, retention_policy_id, created_at, updated_at)
      VALUES
        ('00000000-0000-4000-8000-000000000001', 'Tenant', '00000000-0000-4000-8000-000000000011', 1, '{}', 'confidential', 'r', now(), now()),
        ('00000000-0000-4000-8000-000000000002', 'Tenant', '00000000-0000-4000-8000-000000000022', 1, '{}', 'confidential', 'r', now(), now())
      ON CONFLICT DO NOTHING
    `);
  });

  afterAll(async () => pool.end());

  it('denies cross-tenant reads even when application omits a tenant predicate', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE deliberation_identity_access_runtime');
      await client.query("SELECT set_config('app.tenant_id', '00000000-0000-4000-8000-000000000001', true)");
      const result = await client.query('SELECT tenant_id FROM identity_access.aggregates');
      expect(result.rows).toEqual([{ tenant_id: '00000000-0000-4000-8000-000000000001' }]);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('rejects a cross-tenant insert under runtime role', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE deliberation_identity_access_runtime');
      await client.query("SELECT set_config('app.tenant_id', '00000000-0000-4000-8000-000000000001', true)");
      await expect(client.query(`
        INSERT INTO identity_access.aggregates
          (tenant_id, aggregate_type, aggregate_id, version, state, classification, retention_policy_id, created_at, updated_at)
        VALUES
          ('00000000-0000-4000-8000-000000000002', 'Tenant', '00000000-0000-4000-8000-000000000099', 1, '{}', 'confidential', 'r', now(), now())
      `)).rejects.toThrow();
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('applies tenant RLS to inbox deduplication records', async () => {
    await pool.query(`
      INSERT INTO identity_access.inbox (consumer_name, event_id, tenant_id, processed_at)
      VALUES
        ('projection', '00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000001', now()),
        ('projection', '00000000-0000-4000-8000-000000000032', '00000000-0000-4000-8000-000000000002', now())
      ON CONFLICT DO NOTHING
    `);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE deliberation_identity_access_runtime');
      await client.query("SELECT set_config('app.tenant_id', '00000000-0000-4000-8000-000000000001', true)");
      const result = await client.query('SELECT tenant_id FROM identity_access.inbox');
      expect(result.rows).toEqual([{ tenant_id: '00000000-0000-4000-8000-000000000001' }]);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
