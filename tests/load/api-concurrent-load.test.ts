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
} from '../security/api-process-harness.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
const suite = databaseUrl === undefined ? describe.skip : describe;

const trusted = generateIssuerKeypair();
const LABORATORY_ROLE = 'deliberation_laboratory_runtime';
const CONCURRENT_REQUESTS = 50;

/**
 * A regression guard, not an SLO claim. `config/operations/slos.json` declares `authorization`
 * p99Ms 100 and `command-api` 99.9% availability for production, measured against production
 * capacity; this test runs one API process and one Postgres on a shared, unpinned CI sandbox,
 * so the production number does not transfer unmodified. The bound below is deliberately
 * generous — it catches a collapse under concurrency (pool exhaustion, lock convoy, serialized
 * request handling) without pretending sandbox latency is production latency.
 */
const P99_CEILING_MS = 10_000;

interface Attempt {
  readonly tenantId: string;
  readonly status: number;
  readonly latencyMs: number;
  readonly deliberationId: string;
}

function percentile(sortedMs: readonly number[], fraction: number): number {
  const index = Math.min(sortedMs.length - 1, Math.ceil(fraction * sortedMs.length) - 1);
  return sortedMs[Math.max(0, index)] ?? 0;
}

suite('API sustains concurrent authenticated load without cross-tenant leakage (ADR-047)', () => {
  let api: ApiProcess;
  let pool: pg.Pool;
  let attempts: Attempt[] = [];
  const tenantIds = Array.from({ length: CONCURRENT_REQUESTS }, () => randomUUID());

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl });
    api = await startApi({
      NODE_ENV: 'production',
      DATABASE_URL: databaseUrl ?? '',
      IDENTITY_AUDIENCE: AUDIENCE,
      IDENTITY_TRUSTED_ISSUERS: trustedIssuersConfig(trusted.publicKeyPem),
      // Deliberately far above the request count: this test measures throughput and correctness
      // under concurrency. Rate limiting under concurrency is proven separately in
      // rate-limiter-concurrency.test.ts.
      RATE_LIMIT_PER_PRINCIPAL_PER_MINUTE: '100000',
    });

    // Replay protection (ADR-034) makes every identity token single-use, so each concurrent
    // client needs its own token minted up front rather than a shared one.
    const clients = tenantIds.map((tenantId) => ({
      tenantId,
      authorization: `Bearer ${mintToken(trusted.privateKeyPem, identityClaims(tenantId))}`,
    }));

    attempts = await Promise.all(clients.map(async ({ tenantId, authorization }) => {
      const startedAt = performance.now();
      const response = await postRun(api.baseUrl, { authorization }, laboratoryRequestBody(tenantId));
      return {
        tenantId,
        status: response.status,
        latencyMs: performance.now() - startedAt,
        deliberationId: String(response.body['deliberationId'] ?? ''),
      };
    }));
  }, 180_000);

  afterAll(async () => {
    await api?.stop();
    if (pool !== undefined) {
      await pool.query('DELETE FROM deliberation.outbox WHERE tenant_id = ANY($1::uuid[])', [tenantIds]).catch(() => undefined);
      for (const schema of ['deliberation', 'scenario_planning', 'evaluation']) {
        await pool.query(`DELETE FROM ${schema}.aggregates WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]).catch(() => undefined);
      }
      await pool.end();
    }
  });

  it(`accepts all ${CONCURRENT_REQUESTS} concurrent requests`, () => {
    const failures = attempts.filter((attempt) => attempt.status !== 201);
    expect(failures.map((attempt) => attempt.status)).toEqual([]);
  });

  it('keeps p99 request latency under the documented sandbox bound', () => {
    const sorted = [...attempts.map((attempt) => attempt.latencyMs)].sort((left, right) => left - right);
    const measured = {
      p50: Math.round(percentile(sorted, 0.5)),
      p95: Math.round(percentile(sorted, 0.95)),
      p99: Math.round(percentile(sorted, 0.99)),
      max: Math.round(sorted[sorted.length - 1] ?? 0),
    };
    console.log(JSON.stringify({ msg: 'load.api_concurrent.latency_ms', concurrency: CONCURRENT_REQUESTS, ...measured }));
    expect(measured.p99).toBeLessThan(P99_CEILING_MS);
  });

  it('lands every persisted aggregate under exactly the tenant that authenticated for it', async () => {
    const expected = new Map(attempts.map((attempt) => [attempt.deliberationId, attempt.tenantId]));
    const persisted = await pool.query<{ aggregate_id: string; tenant_id: string }>(
      'SELECT aggregate_id, tenant_id FROM deliberation.aggregates WHERE aggregate_id = ANY($1::uuid[])',
      [[...expected.keys()]],
    );
    expect(persisted.rowCount).toBe(expected.size);
    const misfiled = persisted.rows.filter((row) => expected.get(row.aggregate_id) !== row.tenant_id);
    expect(misfiled).toEqual([]);
  });

  it('does not disclose a concurrently written run to a neighbouring tenant under RLS', async () => {
    const samples = attempts.slice(0, 5);
    const client = await pool.connect();
    try {
      for (const [index, sample] of samples.entries()) {
        const neighbour = samples[(index + 1) % samples.length]?.tenantId ?? '';
        await client.query('BEGIN');
        await client.query(`SET LOCAL ROLE ${LABORATORY_ROLE}`);
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [neighbour]);
        const leaked = await client.query(
          'SELECT tenant_id FROM deliberation.aggregates WHERE aggregate_id = $1',
          [sample.deliberationId],
        );
        expect(leaked.rows).toEqual([]);
        await client.query('ROLLBACK');
      }
    } finally {
      client.release();
    }
  });
});
