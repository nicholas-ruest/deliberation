import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Pool } from 'pg';
import { z } from 'zod';
import { DecisionLaboratory, type LaboratoryInput, type LaboratoryResult } from '../platform/laboratory/index.js';
import { bootstrapTelemetry } from '../platform/observability/otel-bootstrap.js';
import { Telemetry } from '../platform/observability/telemetry.js';
import { contextRuntimeRole, PostgresAggregateStore, PostgresUnitOfWork, type PersistedAggregate } from '../platform/persistence/index.js';
import { PostgresFixedWindowRateLimiter, type RateLimiter } from '../platform/security/postgres-rate-limiter.js';
import { PostgresReplayStore } from '../platform/security/postgres-replay-store.js';
import { EnvSecretProvider, requireSecrets } from '../platform/security/secret-provider.js';
import { TrustedIdentityVerifier, type VerifiedIdentity } from '../platform/security/trusted-identity.js';
import { loadTrustedIssuers } from '../platform/security/trusted-identity-config.js';
import type { AggregateRoot } from '../shared/domain/aggregate-root.js';
import type { DomainEventEnvelope } from '../shared/contracts/envelopes.js';
import { EventFactory, SystemClock, UuidGenerator, type Result } from '../shared/domain/index.js';

const SERVICE_VERSION = process.env['SERVICE_VERSION'] ?? '0.1.0';
const IDENTITY_AUDIENCE = process.env['IDENTITY_AUDIENCE'] ?? 'deliberation-api';
const port = Number.parseInt(process.env['PORT'] ?? '3000', 10);
const RATE_LIMIT_PER_PRINCIPAL_PER_MINUTE = Number.parseInt(process.env['RATE_LIMIT_PER_PRINCIPAL_PER_MINUTE'] ?? '60', 10);

// Fail-closed demo gate: two independent conditions, not one flag pair. `ALLOW_LOCAL_DOMAIN_DEMO`
// alone is not enough — NODE_ENV must also be an explicit non-production value. An unset NODE_ENV
// (a common accidental deployment state) no longer defaults to "demo allowed".
const nodeEnv = process.env['NODE_ENV'];
const explicitlyNonProduction = nodeEnv === 'development' || nodeEnv === 'test';
const demoModeRequested = process.env['ALLOW_LOCAL_DOMAIN_DEMO'] === 'true';
if (nodeEnv === 'production' && demoModeRequested) {
  console.warn('ALLOW_LOCAL_DOMAIN_DEMO is set but NODE_ENV=production — ignoring it and requiring real integrations.');
}
const localDomainDemoEnabled = demoModeRequested && explicitlyNonProduction;

const telemetryHandle = bootstrapTelemetry({ serviceName: 'deliberation-api', serviceVersion: SERVICE_VERSION });
const telemetry = new Telemetry();
const laboratory = new DecisionLaboratory(new SystemClock());
const eventFactory = new EventFactory(new SystemClock(), new UuidGenerator());

interface ProductionIntegrations {
  readonly pool: Pool;
  readonly unitOfWork: PostgresUnitOfWork;
  readonly verifier: TrustedIdentityVerifier;
  readonly rateLimiter: RateLimiter;
}

function bootstrapProductionIntegrations(): ProductionIntegrations {
  const secrets = new EnvSecretProvider();
  requireSecrets(secrets, ['DATABASE_URL']);
  const issuers = loadTrustedIssuers(secrets);
  if (issuers === undefined) {
    throw new Error('IDENTITY_TRUSTED_ISSUERS is not configured. A production/non-demo API cannot ' +
      'start without a trusted identity issuer to verify requests against.');
  }
  const pool = new Pool({ connectionString: secrets.require('DATABASE_URL'), statement_timeout: 5_000, connectionTimeoutMillis: 5_000 });
  return {
    pool,
    unitOfWork: new PostgresUnitOfWork(pool),
    // Postgres-backed, not in-memory: replay checks and rate-limit counters must agree across
    // every replica of this process (api-deployment.yaml runs 3), not just the one that handled
    // a given request (ADR-034).
    verifier: new TrustedIdentityVerifier(issuers, new PostgresReplayStore(pool)),
    rateLimiter: new PostgresFixedWindowRateLimiter(pool, RATE_LIMIT_PER_PRINCIPAL_PER_MINUTE),
  };
}

let integrations: ProductionIntegrations | undefined;
if (!localDomainDemoEnabled) {
  try {
    integrations = bootstrapProductionIntegrations();
  } catch (cause) {
    console.error(`API failed to start: ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exit(1);
  }
}

// Upper bounds sized generously above any realistic legitimate request. The 1MB body cap alone
// does not stop an attacker from packing that budget into thousands of tiny array entries and
// driving DecisionLaboratory.run()'s per-item loops far past any real input shape (ADR-034 item 2).
const BOUNDED_TEXT = z.string().max(4_000);
const SHORT_TEXT = z.string().min(1).max(500);
const MAX_OPTIONS = 50;
const MAX_LIST_ENTRIES = 200;

const Option = z.object({ id: SHORT_TEXT, title: SHORT_TEXT, description: BOUNDED_TEXT.optional() });
const LaboratoryInputSchema = z.object({
  tenantId: z.string().min(1),
  title: SHORT_TEXT,
  contract: z.object({
    question: BOUNDED_TEXT.min(1),
    successDefinition: BOUNDED_TEXT.min(1),
    options: z.array(Option).min(2).max(MAX_OPTIONS),
    generateOptions: z.boolean(),
    constraints: z.array(BOUNDED_TEXT).max(MAX_LIST_ENTRIES),
    stakeholderIds: z.array(SHORT_TEXT).max(MAX_LIST_ENTRIES),
    decisionAuthorityId: z.string().min(1),
    riskClassificationReference: z.string().min(1),
    deadline: z.coerce.date(),
  }),
  stakeholderId: z.string().min(1),
  criteria: z.array(z.object({
    key: SHORT_TEXT, label: SHORT_TEXT, unit: SHORT_TEXT,
    weight: z.number().finite().nonnegative(), state: z.enum(['suggested', 'confirmed', 'retired']),
    inferenceProvenance: BOUNDED_TEXT.optional(),
  })).min(1).max(MAX_LIST_ENTRIES),
  vetoes: z.array(z.object({ key: SHORT_TEXT, predicate: BOUNDED_TEXT, rationale: BOUNDED_TEXT })).max(MAX_LIST_ENTRIES),
  evidenceSnapshotHashes: z.array(z.string().max(200)).max(MAX_LIST_ENTRIES),
  policyVersion: z.string().min(1),
  safetyCaseVersion: z.string().min(1),
  routingPolicyVersion: z.string().min(1),
  reservationId: z.string().min(1),
  budget: z.object({
    branches: z.number().int().positive(), depth: z.number().int().nonnegative(),
    tokens: z.number().int().nonnegative(), moneyMinorUnits: z.number().int().nonnegative(),
    wallTimeMs: z.number().int().positive(), toolCalls: z.number().int().nonnegative(),
    concurrency: z.number().int().positive(),
  }),
  findings: z.array(z.object({
    id: SHORT_TEXT, optionId: SHORT_TEXT, claimId: SHORT_TEXT,
    kind: z.enum(['deterministic', 'policy', 'simulation', 'human', 'model-judgment']),
    status: z.enum(['pass', 'fail', 'uncertain']),
    evidenceReferences: z.array(z.string().max(200)).min(1).max(MAX_LIST_ENTRIES),
    verifierVersion: z.string().min(1),
    rationale: BOUNDED_TEXT.min(1),
    hardConstraint: z.boolean().optional(),
  })).max(MAX_LIST_ENTRIES),
  scores: z.array(z.object({
    optionId: SHORT_TEXT, criterionKey: SHORT_TEXT, value: z.number().finite(),
    unit: SHORT_TEXT, normalizedUtility: z.number().min(0).max(1),
    weight: z.number().finite().nonnegative(), rubricVersion: z.string().min(1),
  })).max(MAX_LIST_ENTRIES),
  assumptions: z.array(BOUNDED_TEXT).max(MAX_LIST_ENTRIES),
  limitations: z.array(BOUNDED_TEXT).max(MAX_LIST_ENTRIES),
});

// Aggregates coming out of DecisionLaboratory.run() are always fresh, first-time writes (the
// laboratory itself is a pure in-memory planner, not a loaded/reloaded aggregate), so every
// persisted row starts at version 1 against an expected prior version of 0. PostgresAggregateStore
// enforces that as a compare-and-swap: a second write to the same (tenant, type, id) with the same
// expectedVersion would be rejected, which is the correct behavior for this single-shot endpoint.
function toPersistedAggregate(identity: VerifiedIdentity, aggregate: AggregateRoot, aggregateType: string, now: Date): PersistedAggregate {
  return {
    tenantId: identity.tenantId,
    aggregateType,
    aggregateId: aggregate.id,
    version: 1,
    state: JSON.parse(JSON.stringify(aggregate)) as Record<string, unknown>,
    classification: 'confidential',
    retentionPolicyId: 'default-decision-record-v1',
    createdAt: now,
    updatedAt: now,
  };
}

async function persistLaboratoryResult(unitOfWork: PostgresUnitOfWork, identity: VerifiedIdentity, correlationId: string, result: LaboratoryResult): Promise<void> {
  const now = new Date();
  const runCompleted: DomainEventEnvelope = eventFactory.create('deliberation.laboratory_run.completed', {
    tenantId: identity.tenantId,
    aggregateType: 'deliberation_case',
    aggregateId: result.deliberation.id,
    aggregateVersion: 1,
    actorId: identity.principalId,
    correlationId,
    purpose: 'decision-support',
    dataClassification: 'confidential',
  }, {
    scenarioTreeId: result.scenarioTree.id,
    evaluationId: result.evaluation.id,
    briefId: result.brief.id,
    briefContentHash: result.brief.contentHash ?? '',
  });

  await unitOfWork.inTenantTransaction(identity.tenantId, async () => {
    const saves: readonly [string, string, AggregateRoot, readonly DomainEventEnvelope[]][] = [
      ['deliberation', 'deliberation_case', result.deliberation, [runCompleted]],
      ['scenario_planning', 'scenario_tree', result.scenarioTree, []],
      ['evaluation', 'evaluation_run', result.evaluation, []],
      ['evaluation', 'decision_brief', result.brief, []],
    ];
    for (const [schema, aggregateType, aggregate, events] of saves) {
      const saved = await new PostgresAggregateStore(schema, unitOfWork)
        .save(toPersistedAggregate(identity, aggregate, aggregateType, now), 0, events);
      if (!saved.ok) throw new Error(`Failed to persist ${aggregateType}: ${saved.error.message}`);
    }
  }, contextRuntimeRole('laboratory'));
}

const server = createServer(async (request, response) => {
  if (request.url === '/health/live') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'live' }));
    return;
  }
  if (request.url === '/health/ready') {
    const ready = localDomainDemoEnabled || (integrations !== undefined && await pingDatabase(integrations.pool));
    response.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      status: ready ? 'ready' : 'not-ready',
      mode: localDomainDemoEnabled ? 'local-domain-demo' : 'production-integrations',
    }));
    return;
  }
  if (request.method === 'POST' && request.url === '/v1/laboratory/runs') {
    const correlationId = extractCorrelationId(request);
    if (localDomainDemoEnabled) {
      await handleDemoRun(request, response, correlationId);
      return;
    }
    await handleVerifiedRun(request, response, correlationId, integrations!);
    return;
  }
  response.writeHead(404, { 'content-type': 'application/problem+json' });
  response.end(JSON.stringify({
    type: 'https://deliberation.example/problems/not-found',
    title: 'Not found',
    status: 404,
    code: 'NOT_FOUND',
    correlationId: randomUUID(),
  }));
});

async function handleDemoRun(request: IncomingMessage, response: ServerResponse, correlationId: string): Promise<void> {
  const tenantId = request.headers['x-tenant-id']?.toString();
  const principalId = request.headers['x-principal-id']?.toString();
  if (tenantId === undefined || principalId === undefined) {
    problem(response, 401, 'UNAUTHENTICATED', correlationId);
    return;
  }
  try {
    const candidate = LaboratoryInputSchema.parse(await readJsonBody(request, 1_000_000));
    if (candidate.tenantId !== tenantId) {
      problem(response, 403, 'PERMISSION_DENIED', correlationId);
      return;
    }
    const result = laboratory.run(candidate as LaboratoryInput);
    writeLaboratoryResult(response, correlationId, result);
  } catch (cause) {
    problem(response, 400, cause instanceof z.ZodError ? 'INVALID_ARGUMENT' : 'INTERNAL', correlationId);
  }
}

async function handleVerifiedRun(
  request: IncomingMessage,
  response: ServerResponse,
  correlationId: string,
  { unitOfWork, verifier, rateLimiter }: ProductionIntegrations,
): Promise<void> {
  const token = extractBearerToken(request);
  if (token === undefined) {
    reject(response, 401, 'UNAUTHENTICATED', correlationId, 'unauthenticated');
    return;
  }
  const identity = await verifier.verify(token, IDENTITY_AUDIENCE);
  if (!identity.ok) {
    // The specific reason ("Invalid token signature", "Replayed identity token", ...) is
    // deliberately not sent to the client — it would hand an attacker a free oracle for
    // iterating on a forged token (ADR-034 item 7). It is still recorded via telemetry (item 4)
    // and this server-side log line, keyed by the same correlation ID returned to the client.
    reject(response, 403, identity.error.code, correlationId, reasonCodeOf(identity.error), identity.error.message);
    return;
  }
  const decision = await rateLimiter.consume(`${identity.value.tenantId}:${identity.value.principalId}`);
  if (!decision.allowed) {
    response.setHeader('retry-after', '60');
    reject(response, 429, 'RATE_LIMITED', correlationId, 'rate_limited');
    return;
  }
  await telemetry.operation('laboratory.run', { operation: 'laboratory_run', workflow_type: 'decision-laboratory' }, async () => {
    try {
      const candidate = LaboratoryInputSchema.parse(await readJsonBody(request, 1_000_000));
      if (candidate.tenantId !== identity.value.tenantId) {
        reject(response, 403, 'PERMISSION_DENIED', correlationId, 'tenant_mismatch');
        return;
      }
      const result = laboratory.run(candidate as LaboratoryInput);
      if (result.ok) await persistLaboratoryResult(unitOfWork, identity.value, correlationId, result.value);
      writeLaboratoryResult(response, correlationId, result);
    } catch (cause) {
      problem(response, 400, cause instanceof z.ZodError ? 'INVALID_ARGUMENT' : 'INTERNAL', correlationId);
    }
  });
}

function reasonCodeOf(error: { readonly details?: Readonly<Record<string, unknown>> }): string {
  const code = error.details?.['reasonCode'];
  return typeof code === 'string' ? code : 'unknown';
}

/** A rejection that never reaches business logic: records telemetry + a server-side log line
 * keyed by correlationId, then responds with only the stable code — no detailed reason. */
function reject(response: ServerResponse, status: number, code: string, correlationId: string, reasonCode: string, logDetail?: string): void {
  telemetry.recordRejection({ operation: 'laboratory_run', reason_code: reasonCode });
  console.warn(JSON.stringify({ level: 'warn', msg: 'request.rejected', correlationId, reasonCode, ...(logDetail === undefined ? {} : { detail: logDetail }) }));
  problem(response, status, code, correlationId);
}

function writeLaboratoryResult(response: ServerResponse, correlationId: string, result: Result<LaboratoryResult>): void {
  if (!result.ok) {
    problem(response, result.error.code === 'ABSTAINED' ? 422 : 409, result.error.code, correlationId, result.error.message);
    return;
  }
  response.writeHead(201, { 'content-type': 'application/json', 'x-correlation-id': correlationId });
  response.end(JSON.stringify({
    deliberationId: result.value.deliberation.id,
    scenarioTreeId: result.value.scenarioTree.id,
    evaluationId: result.value.evaluation.id,
    briefId: result.value.brief.id,
    briefContentHash: result.value.brief.contentHash,
    state: result.value.deliberation.state,
  }));
}

function extractBearerToken(request: IncomingMessage): string | undefined {
  const header = request.headers['authorization'];
  const value = Array.isArray(header) ? header[0] : header;
  return value?.startsWith('Bearer ') ? value.slice('Bearer '.length) : undefined;
}

const CorrelationId = z.string().uuid();
function extractCorrelationId(request: IncomingMessage): string {
  const header = request.headers['x-correlation-id']?.toString();
  return header !== undefined && CorrelationId.safeParse(header).success ? header : randomUUID();
}

async function pingDatabase(pool: Pool): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

async function readJsonBody(request: IncomingMessage, maximumBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > maximumBytes) throw new Error('Request body too large');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function problem(response: ServerResponse, status: number, code: string, correlationId: string, detail?: string): void {
  response.writeHead(status, { 'content-type': 'application/problem+json', 'x-correlation-id': correlationId });
  response.end(JSON.stringify({
    type: `https://deliberation.example/problems/${code.toLowerCase()}`,
    title: code,
    status,
    code,
    correlationId,
    ...(detail === undefined ? {} : { detail }),
  }));
}

server.listen(port, localDomainDemoEnabled ? '127.0.0.1' : '0.0.0.0');

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    server.close((error) => {
      process.exitCode = error === undefined ? 0 : 1;
    });
    void Promise.allSettled([integrations?.pool.end(), telemetryHandle.shutdown()]);
  });
}
