import { readFile } from 'node:fs/promises';

for (const file of ['Dockerfile.api', 'Dockerfile.worker']) {
  const source = await readFile(file, 'utf8');
  for (const required of ['@sha256:', 'USER 10001:10001', 'npm ci --omit=dev --ignore-scripts']) {
    if (!source.includes(required)) throw new Error(`${file} lacks ${required}`);
  }
}

for (const file of ['config/kubernetes/api-deployment.yaml', 'config/kubernetes/worker-deployment.yaml']) {
  const source = await readFile(file, 'utf8');
  for (const required of [
    'runAsNonRoot: true', 'allowPrivilegeEscalation: false', 'readOnlyRootFilesystem: true',
    'capabilities: { drop: ["ALL"] }', 'automountServiceAccountToken: false',
    'topologyKey: topology.kubernetes.io/zone', 'image: deliberation-',
  ]) {
    if (!source.includes(required)) throw new Error(`${file} lacks ${required}`);
  }
  const expected = file.includes('api-') ? 'api' : 'worker';
  const images = [...source.matchAll(/^\s*image:\s*(\S+)\s*$/gm)].map((match) => match[1]);
  const releaseDigest = process.env[expected === 'api' ? 'RELEASE_API_IMAGE_DIGEST' : 'RELEASE_WORKER_IMAGE_DIGEST'];
  const expectedImage = releaseDigest === undefined
    ? `deliberation-${expected}@sha256:RELEASE_DIGEST_REQUIRED`
    : `deliberation-${expected}@sha256:${releaseDigest}`;
  if (images.length !== 1 || images[0] !== expectedImage
    || (releaseDigest !== undefined && !/^[a-f0-9]{64}$/.test(releaseDigest))) {
    throw new Error(`${file} must contain exactly one expected image bound to its release digest or static template marker`);
  }
}
console.log('Deployment policy checks passed.');
