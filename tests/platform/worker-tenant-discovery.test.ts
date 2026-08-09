import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl = process.env['TEST_DATABASE_URL'];
const suite = databaseUrl === undefined ? describe.skip : describe;

async function waitForReady(baseUrl: string, deadlineMs: number): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health/ready`);
      if (response.status === 200) return;
    } catch { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Worker did not become ready in time');
}

/** Spawns the real worker.ts with tenant discovery enabled (WORKER_TENANT_IDS deliberately unset). */
async function startDiscoveringWorker(port: number): Promise<{ stop: () => void; logs: () => string }> {
  const serverPath = fileURLToPath(new URL('../../src/apps/worker.ts', import.meta.url));
  let output = '';
  const child: ChildProcessWithoutNullStreams = spawn('npx', ['tsx', serverPath], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl ?? '',
      WORKER_HEALTH_PORT: String(port),
      WORKER_POLL_INTERVAL_MS: '300',
      WORKER_TENANT_DISCOVERY_INTERVAL_MS: '300',
      WORKER_TENANT_IDS: '',
    },
    stdio: 'pipe',
  });
  child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
  child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
  await waitForReady(`http://127.0.0.1:${port}`, 20_000);
  return { stop: () => child.kill('SIGTERM'), logs: () => output };
}

suite('Worker tenant discovery (ADR-049)', () => {
  let pool: pg.Pool;
  const activeTenantId = randomUUID();
  const suspendedTenantId = randomUUID();

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl });
    await pool.query(
      `INSERT INTO identity_access.aggregates
         (tenant_id, aggregate_type, aggregate_id, version, state, classification, retention_policy_id, created_at, updated_at)
       VALUES
         ($1, 'Tenant', $1, 1, '{"state":"active"}'::jsonb, 'confidential', 'r', now(), now()),
         ($2, 'Tenant', $2, 1, '{"state":"suspended"}'::jsonb, 'confidential', 'r', now(), now())`,
      [activeTenantId, suspendedTenantId],
    );
  }, 30_000);

  afterAll(async () => pool?.end());

  it('the restricted discovery role can enumerate active tenants but nothing else', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE deliberation_worker_discovery_runtime');
      const result = await client.query<{ list_active_tenant_ids: string }>('SELECT * FROM identity_access.list_active_tenant_ids()');
      const ids = result.rows.map((row) => row.list_active_tenant_ids);
      expect(ids).toContain(activeTenantId);
      expect(ids).not.toContain(suspendedTenantId);
      await expect(client.query('SELECT * FROM identity_access.aggregates')).rejects.toThrow(/permission denied/i);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('a worker with no WORKER_TENANT_IDS discovers and relays only the active tenant\'s outbox', async () => {
    await pool.query(
      `INSERT INTO deliberation.outbox (event_id, tenant_id, aggregate_id, aggregate_version, event_type, schema_version, envelope, recorded_at)
       VALUES (gen_random_uuid(), $1, gen_random_uuid(), 1, 'test.discovery.active', 1, '{"marker":"active"}'::jsonb, now()),
              (gen_random_uuid(), $2, gen_random_uuid(), 1, 'test.discovery.suspended', 1, '{"marker":"suspended"}'::jsonb, now())`,
      [activeTenantId, suspendedTenantId],
    );

    const worker = await startDiscoveringWorker(3110);
    try {
      // Connected as the postgres superuser (TEST_DATABASE_URL), which bypasses RLS regardless of
      // app.tenant_id — appropriate here since this is a state-readback assertion, not itself a
      // tenant-isolation test (that property is already covered directly above and in
      // tests/security/api-tenant-isolation.test.ts).
      const deadline = Date.now() + 10_000;
      let activePublished = false;
      while (Date.now() < deadline && !activePublished) {
        const result = await pool.query<{ published_at: Date | null }>(
          "SELECT published_at FROM deliberation.outbox WHERE tenant_id = $1 AND event_type = 'test.discovery.active'",
          [activeTenantId],
        );
        activePublished = result.rows[0]?.published_at != null;
        if (!activePublished) await new Promise((resolve) => setTimeout(resolve, 300));
      }
      expect(activePublished).toBe(true);
      expect(worker.logs()).toContain('relying on tenant discovery');

      const suspendedResult = await pool.query<{ published_at: Date | null }>(
        "SELECT published_at FROM deliberation.outbox WHERE tenant_id = $1 AND event_type = 'test.discovery.suspended'",
        [suspendedTenantId],
      );
      expect(suspendedResult.rows[0]?.published_at ?? null).toBeNull();
    } finally {
      worker.stop();
    }
  }, 30_000);
});
