import { spawn } from 'node:child_process';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

export const TRUSTED_ISSUER = 'https://issuer.security-suite.invalid';
export const TRUSTED_KID = 'security-suite-key-1';
export const AUDIENCE = 'deliberation-api';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const tsxBinary = fileURLToPath(new URL('../../node_modules/.bin/tsx', import.meta.url));

export interface IssuerKeypair {
  readonly publicKeyPem: string;
  readonly privateKeyPem: string;
}

export function generateIssuerKeypair(): IssuerKeypair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKeyPem: publicKey, privateKeyPem: privateKey };
}

export function trustedIssuersConfig(publicKeyPem: string): string {
  return JSON.stringify([{
    issuer: TRUSTED_ISSUER,
    audiences: [AUDIENCE],
    keys: [{ kid: TRUSTED_KID, publicKeyPem }],
  }]);
}

const base64url = (value: string): string => Buffer.from(value, 'utf8').toString('base64url');

export function identityClaims(tenantId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const issuedAt = Math.floor(Date.now() / 1000);
  return {
    iss: TRUSTED_ISSUER,
    aud: AUDIENCE,
    sub: `principal-${randomUUID()}`,
    tenant_id: tenantId,
    session_epoch: 1,
    jti: randomUUID(),
    iat: issuedAt,
    exp: issuedAt + 300,
    ...overrides,
  };
}

export function mintToken(privateKeyPem: string, claims: Record<string, unknown>, kid: string = TRUSTED_KID): string {
  const encodedHeader = base64url(JSON.stringify({ alg: 'EdDSA', kid }));
  const encodedPayload = base64url(JSON.stringify(claims));
  const signature = sign(null, Buffer.from(`${encodedHeader}.${encodedPayload}`), privateKeyPem);
  return `${encodedHeader}.${encodedPayload}.${signature.toString('base64url')}`;
}

export interface ApiProcess {
  readonly baseUrl: string;
  stop(): Promise<void>;
}

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

const delay = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Starts the real `src/apps/api.ts` entrypoint as a child process. That file calls
 * `server.listen()` at import time and reads its whole configuration from the environment, so
 * the only faithful way to assert its fail-closed behavior is to run it as deployed rather than
 * to import it. The child is detached so the whole process group (tsx wrapper included) can be
 * signalled on teardown.
 */
export async function startApi(env: Record<string, string>, readyTimeoutMs = 60_000): Promise<ApiProcess> {
  const port = await reserveFreePort();
  const child = spawn(tsxBinary, ['src/apps/api.ts'], {
    cwd: repositoryRoot,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env['PATH'] ?? '', HOME: process.env['HOME'] ?? '', PORT: String(port), ...env },
  });

  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
  child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
  let exited = false;
  child.once('exit', () => { exited = true; });

  const stop = async (): Promise<void> => {
    const pid = child.pid;
    if (pid === undefined) return;
    if (!exited) { try { process.kill(-pid, 'SIGTERM'); } catch { /* already gone */ } }
    for (let attempt = 0; attempt < 25 && !exited; attempt += 1) await delay(100);
    if (!exited) { try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ } }
  };

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + readyTimeoutMs;
  while (Date.now() < deadline) {
    if (exited) throw new Error(`API process exited before becoming ready:\n${output}`);
    try {
      const response = await fetch(`${baseUrl}/health/ready`);
      if (response.status === 200) return { baseUrl, stop };
    } catch { /* not listening yet */ }
    await delay(200);
  }
  await stop();
  throw new Error(`API process never became ready within ${readyTimeoutMs}ms:\n${output}`);
}

/**
 * A request body that `DecisionLaboratory` accepts end to end, so that anything the API rejects
 * in these tests is rejected by the security boundary under test and not by domain validation.
 */
export function laboratoryRequestBody(tenantId: string): Record<string, unknown> {
  return {
    tenantId,
    title: 'Choose a supplier',
    contract: {
      question: 'Which qualified supplier should we choose?',
      successDefinition: 'Best compliant value',
      options: [{ id: 'a', title: 'Supplier A' }, { id: 'b', title: 'Supplier B' }],
      generateOptions: false,
      constraints: ['legal'],
      stakeholderIds: ['stakeholder'],
      decisionAuthorityId: 'human',
      riskClassificationReference: 'moderate',
      deadline: '2027-01-01T00:00:00.000Z',
    },
    stakeholderId: 'stakeholder',
    criteria: [{ key: 'value', label: 'Value', unit: 'points', weight: 1, state: 'confirmed' }],
    vetoes: [],
    evidenceSnapshotHashes: ['evidence-hash'],
    policyVersion: 'policy:1',
    safetyCaseVersion: 'safety:1',
    routingPolicyVersion: 'router:1',
    reservationId: 'reservation',
    budget: { branches: 1, depth: 0, tokens: 10, moneyMinorUnits: 10, wallTimeMs: 1000, toolCalls: 0, concurrency: 1 },
    findings: [
      {
        id: 'fa', optionId: 'a', claimId: 'legal-a', kind: 'policy', status: 'pass',
        evidenceReferences: ['evidence-a'], verifierVersion: '1', rationale: 'Supplier A is eligible',
      },
      {
        id: 'fb', optionId: 'b', claimId: 'legal-b', kind: 'policy', status: 'pass',
        evidenceReferences: ['evidence-b'], verifierVersion: '1', rationale: 'Supplier B is eligible',
      },
    ],
    scores: [
      { optionId: 'a', criterionKey: 'value', value: 80, unit: 'points', normalizedUtility: 0.8, weight: 1, rubricVersion: '1' },
      { optionId: 'b', criterionKey: 'value', value: 60, unit: 'points', normalizedUtility: 0.6, weight: 1, rubricVersion: '1' },
    ],
    assumptions: ['Evidence remains current'],
    limitations: ['The platform does not make the human decision'],
  };
}

export interface ApiResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export async function postRun(
  baseUrl: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<ApiResponse> {
  const response = await fetch(`${baseUrl}/v1/laboratory/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    parsed = { raw: text };
  }
  return { status: response.status, body: parsed };
}
