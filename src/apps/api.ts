import { createServer } from 'node:http';
import { z } from 'zod';
import { DecisionLaboratory, type LaboratoryInput } from '../platform/laboratory/index.js';
import { SystemClock } from '../shared/domain/index.js';

const port = Number.parseInt(process.env['PORT'] ?? '3000', 10);
const localDomainDemoEnabled = process.env['ALLOW_LOCAL_DOMAIN_DEMO'] === 'true';
const laboratory = new DecisionLaboratory(new SystemClock());
const Option = z.object({ id: z.string().min(1), title: z.string().min(1), description: z.string().optional() });
const LaboratoryInputSchema = z.object({
  tenantId: z.string().min(1),
  title: z.string().min(1),
  contract: z.object({
    question: z.string().min(1),
    successDefinition: z.string().min(1),
    options: z.array(Option).min(2),
    generateOptions: z.boolean(),
    constraints: z.array(z.string()),
    stakeholderIds: z.array(z.string()),
    decisionAuthorityId: z.string().min(1),
    riskClassificationReference: z.string().min(1),
    deadline: z.coerce.date(),
  }),
  stakeholderId: z.string().min(1),
  criteria: z.array(z.object({
    key: z.string().min(1), label: z.string().min(1), unit: z.string().min(1),
    weight: z.number().finite().nonnegative(), state: z.enum(['suggested', 'confirmed', 'retired']),
    inferenceProvenance: z.string().optional(),
  })).min(1),
  vetoes: z.array(z.object({ key: z.string(), predicate: z.string(), rationale: z.string() })),
  evidenceSnapshotHashes: z.array(z.string()),
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
    id: z.string(), optionId: z.string(), claimId: z.string(),
    kind: z.enum(['deterministic', 'policy', 'simulation', 'human', 'model-judgment']),
    status: z.enum(['pass', 'fail', 'uncertain']),
    evidenceReferences: z.array(z.string()).min(1),
    verifierVersion: z.string().min(1),
    rationale: z.string().min(1),
    hardConstraint: z.boolean().optional(),
  })),
  scores: z.array(z.object({
    optionId: z.string(), criterionKey: z.string(), value: z.number().finite(),
    unit: z.string().min(1), normalizedUtility: z.number().min(0).max(1),
    weight: z.number().finite().nonnegative(), rubricVersion: z.string().min(1),
  })),
  assumptions: z.array(z.string()),
  limitations: z.array(z.string()),
});

const server = createServer(async (request, response) => {
  if (request.url === '/health/live') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'live' }));
    return;
  }
  if (request.url === '/health/ready') {
    response.writeHead(localDomainDemoEnabled ? 200 : 503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      status: localDomainDemoEnabled ? 'ready' : 'not-ready',
      mode: localDomainDemoEnabled ? 'local-domain-demo' : 'production-integrations-unconfigured',
    }));
    return;
  }
  if (request.method === 'POST' && request.url === '/v1/laboratory/runs') {
    const correlationId = request.headers['x-correlation-id']?.toString() ?? crypto.randomUUID();
    if (!localDomainDemoEnabled) {
      problem(response, 503, 'PRODUCTION_INTEGRATIONS_UNCONFIGURED', correlationId);
      return;
    }
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
      return;
    } catch (cause) {
      problem(response, 400, cause instanceof z.ZodError ? 'INVALID_ARGUMENT' : 'INTERNAL', correlationId);
      return;
    }
  }
  response.writeHead(404, { 'content-type': 'application/problem+json' });
  response.end(JSON.stringify({
    type: 'https://deliberation.example/problems/not-found',
    title: 'Not found',
    status: 404,
    code: 'NOT_FOUND',
    correlationId: crypto.randomUUID(),
  }));
});

async function readJsonBody(request: import('node:http').IncomingMessage, maximumBytes: number): Promise<unknown> {
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

function problem(
  response: import('node:http').ServerResponse,
  status: number,
  code: string,
  correlationId: string,
  detail?: string,
): void {
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

server.listen(port, '0.0.0.0');

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    server.close((error) => {
      process.exitCode = error === undefined ? 0 : 1;
    });
  });
}
