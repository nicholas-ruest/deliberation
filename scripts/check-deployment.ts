import { readFile } from 'node:fs/promises';

for (const file of ['Dockerfile.api', 'Dockerfile.worker', 'Dockerfile.web']) {
  const source = await readFile(file, 'utf8');
  for (const required of ['@sha256:', 'USER 10001:10001', 'npm ci --omit=dev --ignore-scripts']) {
    if (!source.includes(required)) throw new Error(`${file} lacks ${required}`);
  }
}

for (const file of [
  'config/kubernetes/api-deployment.yaml',
  'config/kubernetes/worker-deployment.yaml',
  'config/kubernetes/web-deployment.yaml',
]) {
  const source = await readFile(file, 'utf8');
  for (const required of [
    'runAsNonRoot: true', 'allowPrivilegeEscalation: false', 'readOnlyRootFilesystem: true',
    'capabilities: { drop: ["ALL"] }', 'automountServiceAccountToken: false',
    'topologyKey: topology.kubernetes.io/zone', 'image: deliberation-',
    'namespace: deliberation-cell',
    'audience: deliberation-cell-',
    'expirationSeconds: 600',
  ]) {
    if (!source.includes(required)) throw new Error(`${file} lacks ${required}`);
  }
  const expected = file.includes('api-') ? 'api' : file.includes('web-') ? 'web' : 'worker';
  if (!source.includes(`serviceAccountName: deliberation-${expected}`)) {
    throw new Error(`${file} must use the dedicated deliberation-${expected} workload identity`);
  }
  const images = [...source.matchAll(/^\s*image:\s*(\S+)\s*$/gm)].map((match) => match[1]);
  const releaseDigest = process.env[
    expected === 'api' ? 'RELEASE_API_IMAGE_DIGEST'
      : expected === 'web' ? 'RELEASE_WEB_IMAGE_DIGEST'
        : 'RELEASE_WORKER_IMAGE_DIGEST'
  ];
  const expectedImage = releaseDigest === undefined
    ? `deliberation-${expected}@sha256:RELEASE_DIGEST_REQUIRED`
    : `deliberation-${expected}@sha256:${releaseDigest}`;
  if (images.length !== 1 || images[0] !== expectedImage
    || (releaseDigest !== undefined && !/^[a-f0-9]{64}$/.test(releaseDigest))) {
    throw new Error(`${file} must contain exactly one expected image bound to its release digest or static template marker`);
  }
}

const cellFoundation = await readFile('config/kubernetes/cell-foundation.yaml', 'utf8');
for (const required of [
  'pod-security.kubernetes.io/enforce: restricted',
  'deliberation.io/cell-id: CELL_ID_REQUIRED',
  'kind: NetworkPolicy',
  'name: default-deny',
  'name: allow-edge-ingress',
  'name: allow-dns-egress',
  'name: allow-private-cell-dependencies',
  'deliberation.io/workload-identity:',
  'policyTypes: [Ingress, Egress]',
  'kind: PodDisruptionBudget',
  'kind: HorizontalPodAutoscaler',
  'kind: ResourceQuota',
]) {
  if (!cellFoundation.includes(required)) throw new Error(`Cell foundation lacks ${required}`);
}
const serviceAccounts = [...cellFoundation.matchAll(/^kind: ServiceAccount$[\s\S]*?^\s*name:\s*(\S+)$/gm)]
  .map((match) => match[1]);
for (const workload of ['deliberation-api', 'deliberation-worker', 'deliberation-web']) {
  if (!serviceAccounts.includes(workload)) throw new Error(`Cell foundation lacks dedicated ${workload} service account`);
}
console.log('Deployment policy checks passed.');
