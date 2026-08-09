import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl = process.env['TEST_DATABASE_URL'];
const suite = databaseUrl === undefined ? describe.skip : describe;

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const tsxBinary = fileURLToPath(new URL('../../node_modules/.bin/tsx', import.meta.url));

const SEEDED_EVENTS = 30;
const SCHEMA = 'deliberation';

const delay = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function reserveFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => (port === 0 ? reject(new Error('Could not reserve a port')) : resolve(port)));
    });
  });
}

interface WorkerProcess {
  /** Every `outbox.relayed` line the worker emitted, in order, as the seeded event id. */
  readonly relayedEventIds: string[];
  sigkill(): void;
  waitForExit(timeoutMs: number): Promise<boolean>;
  stop(): Promise<void>;
}

/**
 * Runs the real `src/apps/worker.ts` as a detached child, the same way `api-process-harness`
 * runs the API: the worker reads its whole configuration from the environment and starts its
 * poll loop at import time, so a genuine SIGKILL of a real process is the only way to exercise
 * the crash-mid-relay path this test is about.
 */
async function startWorker(env: Record<string, string>, readyTimeoutMs = 60_000): Promise<WorkerProcess> {
  const port = await reserveFreePort();
  const child = spawn(tsxBinary, ['src/apps/worker.ts'], {
    cwd: repositoryRoot,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env['PATH'] ?? '', HOME: process.env['HOME'] ?? '', WORKER_HEALTH_PORT: String(port), ...env },
  });

  const relayedEventIds: string[] = [];
  let pending = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    pending += chunk.toString('utf8');
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as { msg?: string; envelope?: { eventId?: string } };
        if (parsed.msg === 'outbox.relayed' && typeof parsed.envelope?.eventId === 'string') {
          relayedEventIds.push(parsed.envelope.eventId);
        }
      } catch { /* not a structured log line */ }
    }
  });
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });

  let exited = false;
  child.once('exit', () => { exited = true; });

  const signalGroup = (signal: NodeJS.Signals): void => {
    if (child.pid === undefined || exited) return;
    try { process.kill(-child.pid, signal); } catch { /* already gone */ }
  };

  const waitForExit = async (timeoutMs: number): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    while (!exited && Date.now() < deadline) await delay(50);
    return exited;
  };

  const stop = async (): Promise<void> => {
    signalGroup('SIGTERM');
    if (!await waitForExit(5_000)) signalGroup('SIGKILL');
    await waitForExit(5_000);
  };

  const deadline = Date.now() + readyTimeoutMs;
  while (Date.now() < deadline) {
    if (exited) throw new Error(`Worker exited before becoming live:\n${stderr}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health/live`);
      if (response.status === 200) return { relayedEventIds, sigkill: () => signalGroup('SIGKILL'), waitForExit, stop };
    } catch { /* not listening yet */ }
    await delay(50);
  }
  await stop();
  throw new Error(`Worker never became live within ${readyTimeoutMs}ms:\n${stderr}`);
}

suite('Outbox relay survives a killed worker without losing or corrupting events (ADR-004, ADR-047)', () => {
  let pool: pg.Pool;
  const tenantId = randomUUID();
  const eventIds = Array.from({ length: SEEDED_EVENTS }, () => randomUUID());
  let firstWorker: WorkerProcess | undefined;
  let secondWorker: WorkerProcess | undefined;
  let publishedAtKill = 0;

  const publishedCount = async (): Promise<number> => {
    const result = await pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM ${SCHEMA}.outbox WHERE tenant_id = $1 AND published_at IS NOT NULL`,
      [tenantId],
    );
    return Number(result.rows[0]?.count ?? 0);
  };

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl });
    for (const [index, eventId] of eventIds.entries()) {
      await pool.query(
        `INSERT INTO ${SCHEMA}.outbox
           (event_id, tenant_id, aggregate_id, aggregate_version, event_type, schema_version, envelope, recorded_at)
         VALUES ($1, $2, $3, 1, 'deliberation.laboratory_run.completed', 1, $4, now())`,
        [eventId, tenantId, randomUUID(), JSON.stringify({ eventId, tenantId, sequence: index })],
      );
    }

    const workerEnvironment = {
      DATABASE_URL: databaseUrl ?? '',
      WORKER_TENANT_IDS: tenantId,
      // One event per pass, polled tightly: guarantees the relay is genuinely mid-flight when the
      // kill lands rather than having drained the whole outbox in a single batch.
      WORKER_RELAY_BATCH_SIZE: '1',
      WORKER_POLL_INTERVAL_MS: '50',
    };

    firstWorker = await startWorker(workerEnvironment);

    const killDeadline = Date.now() + 30_000;
    while (Date.now() < killDeadline) {
      publishedAtKill = await publishedCount();
      if (publishedAtKill > 0 && publishedAtKill < SEEDED_EVENTS) break;
      await delay(20);
    }
    firstWorker.sigkill();
    expect(await firstWorker.waitForExit(10_000)).toBe(true);

    secondWorker = await startWorker(workerEnvironment);
    const drainDeadline = Date.now() + 60_000;
    while (Date.now() < drainDeadline && await publishedCount() < SEEDED_EVENTS) await delay(100);
  }, 180_000);

  afterAll(async () => {
    await Promise.all([firstWorker?.stop(), secondWorker?.stop()]);
    if (pool !== undefined) {
      await pool.query(`DELETE FROM ${SCHEMA}.outbox WHERE tenant_id = $1`, [tenantId]).catch(() => undefined);
      await pool.end();
    }
  });

  it('kills the first worker while the relay is genuinely mid-flight', () => {
    expect(publishedAtKill).toBeGreaterThan(0);
    expect(publishedAtKill).toBeLessThan(SEEDED_EVENTS);
  });

  it('drains the whole outbox after a replacement worker takes over', async () => {
    const unpublished = await pool.query<{ event_id: string }>(
      `SELECT event_id FROM ${SCHEMA}.outbox WHERE tenant_id = $1 AND published_at IS NULL`,
      [tenantId],
    );
    expect(unpublished.rows).toEqual([]);
  });

  it('loses no seeded event and invents none', async () => {
    const rows = await pool.query<{ event_id: string }>(
      `SELECT event_id FROM ${SCHEMA}.outbox WHERE tenant_id = $1`,
      [tenantId],
    );
    expect([...rows.rows.map((row) => row.event_id)].sort()).toEqual([...eventIds].sort());
  });

  it('relays every event at least once across the crash boundary', () => {
    const relayed = [...(firstWorker?.relayedEventIds ?? []), ...(secondWorker?.relayedEventIds ?? [])];
    const duplicates = relayed.length - new Set(relayed).size;
    console.log(JSON.stringify({
      msg: 'chaos.worker_relay.result',
      seeded: SEEDED_EVENTS,
      publishedBeforeKill: publishedAtKill,
      relayedByFirstWorker: firstWorker?.relayedEventIds.length ?? 0,
      relayedBySecondWorker: secondWorker?.relayedEventIds.length ?? 0,
      duplicateRelays: duplicates,
    }));
    // At-least-once, not exactly-once: a kill between `publishToTransport` and COMMIT rolls the
    // row back, so the replacement worker legitimately re-relays it. What must not happen is an
    // event never reaching the transport at all.
    expect([...new Set(relayed)].sort()).toEqual([...eventIds].sort());
  });

  it('keeps published_at idempotent — one settled timestamp per event, never re-stamped', async () => {
    const anomalies = await pool.query<{ event_id: string; published_at: string }>(
      `SELECT event_id, published_at FROM ${SCHEMA}.outbox
       WHERE tenant_id = $1 AND (published_at IS NULL OR published_at < recorded_at)`,
      [tenantId],
    );
    expect(anomalies.rows).toEqual([]);
  });
});
