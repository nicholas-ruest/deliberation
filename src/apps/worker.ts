import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { bootstrapTelemetry } from '../platform/observability/otel-bootstrap.js';
import { Telemetry } from '../platform/observability/telemetry.js';
import { CONTEXT_SCHEMAS } from '../platform/persistence/context-schemas.js';
import { contextRuntimeRole, PostgresUnitOfWork } from '../platform/persistence/postgres.js';
import { EnvSecretProvider, requireSecrets } from '../platform/security/secret-provider.js';

const SERVICE_VERSION = process.env['SERVICE_VERSION'] ?? '0.1.0';
const healthPort = Number.parseInt(process.env['WORKER_HEALTH_PORT'] ?? '3001', 10);
const pollIntervalMs = Number.parseInt(process.env['WORKER_POLL_INTERVAL_MS'] ?? '1000', 10);
const relayBatchSize = Number.parseInt(process.env['WORKER_RELAY_BATCH_SIZE'] ?? '100', 10);
const staleAfterMs = Number.parseInt(process.env['WORKER_STALE_AFTER_MS'] ?? '60000', 10);

// Reference consumer, not a production fabric (see ADR-028): this worker relays the outbox for
// an explicit, operator-configured set of tenants. It intentionally does not attempt cross-tenant
// discovery — every outbox table is row-level-security protected per tenant, and this process
// authenticates as an ordinary application role with no RLS bypass. A managed queue/broker
// adapter (ADR-028) remains the upgrade path for automatic multi-tenant fan-out.
const tenantIds = (process.env['WORKER_TENANT_IDS'] ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0);

const secrets = new EnvSecretProvider();
requireSecrets(secrets, ['DATABASE_URL']);
const pool = new Pool({ connectionString: secrets.require('DATABASE_URL'), statement_timeout: 10_000, connectionTimeoutMillis: 5_000 });
const unitOfWork = new PostgresUnitOfWork(pool);
const telemetryHandle = bootstrapTelemetry({ serviceName: 'deliberation-worker', serviceVersion: SERVICE_VERSION });
const telemetry = new Telemetry();

if (tenantIds.length === 0) {
  console.warn('WORKER_TENANT_IDS is empty — this worker is running with nothing to relay. ' +
    'Set a comma-separated list of tenant UUIDs to relay outbox events for.');
}

// Readiness/liveness watermark: a worker that reports healthy while its poll loop has stalled
// (stuck query, deadlock, crashed iteration) is exactly the silent-failure mode this replaces.
let lastPollCompletedAt = new Date();

async function relayPendingOutboxForTenant(schema: string, tenantId: string): Promise<number> {
  return unitOfWork.inTenantTransaction(tenantId, async () => {
    const table = `${schema}.outbox`;
    const selectSql = `SELECT event_id, envelope FROM ${table}
      WHERE tenant_id = $1 AND published_at IS NULL ORDER BY recorded_at ASC LIMIT $2 FOR UPDATE SKIP LOCKED`;
    const rows = await unitOfWork.query<{ event_id: string; envelope: unknown }>(selectSql, [tenantId, relayBatchSize]);
    if (rows.length === 0) return 0;
    const updateSql = `UPDATE ${table} SET published_at = now() WHERE tenant_id = $1 AND event_id = ANY($2::uuid[])`;
    await unitOfWork.query(updateSql, [tenantId, rows.map((row) => row.event_id)]);
    for (const row of rows) publishToTransport(row.envelope);
    return rows.length;
  }, contextRuntimeRole(schema));
}

/**
 * The transport an adopter's managed broker (ADR-028) would replace. Without one configured,
 * relayed events are structured-logged so a self-hosted deployment still has an observable,
 * at-least-once record of what left the outbox, instead of silently discarding it.
 */
function publishToTransport(envelope: unknown): void {
  console.log(JSON.stringify({ level: 'info', msg: 'outbox.relayed', envelope }));
}

function bucketOf(tenantId: string): string {
  let hash = 0;
  for (let index = 0; index < tenantId.length; index += 1) hash = (hash * 31 + tenantId.charCodeAt(index)) >>> 0;
  return String(hash % 16);
}

const healthServer = createServer((request, response) => {
  if (request.url === '/health/live') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'live' }));
    return;
  }
  if (request.url === '/health/ready') {
    const staleness = Date.now() - lastPollCompletedAt.getTime();
    const ready = staleness < staleAfterMs;
    response.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: ready ? 'ready' : 'not-ready', lastPollCompletedAt: lastPollCompletedAt.toISOString(), stalenessMs: staleness }));
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ status: 'not-found' }));
});
healthServer.listen(healthPort, '0.0.0.0');

const controller = new AbortController();
process.once('SIGTERM', () => controller.abort());
process.once('SIGINT', () => controller.abort());

while (!controller.signal.aborted) {
  for (const tenantId of tenantIds) {
    for (const schema of CONTEXT_SCHEMAS) {
      try {
        await telemetry.operation(
          'worker.relay_outbox',
          { operation: 'relay_outbox', dependency: 'postgres', tenant_bucket: bucketOf(tenantId) },
          () => relayPendingOutboxForTenant(schema, tenantId),
        );
      } catch (cause) {
        console.error(`Outbox relay failed for schema=${schema}: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }
  }
  lastPollCompletedAt = new Date();
  await delay(pollIntervalMs, undefined, { signal: controller.signal }).catch(() => undefined);
}

await new Promise<void>((resolve) => healthServer.close(() => resolve()));
await Promise.allSettled([pool.end(), telemetryHandle.shutdown()]);
