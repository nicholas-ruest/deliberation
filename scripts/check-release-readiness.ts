import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * ADR-045: everything about `.github/workflows/release.yml` that can be verified WITHOUT cutting
 * a real tag or pushing to `ghcr.io` — the actual tag-and-push is a deliberate, one-time, human
 * decision outside this script's scope. This narrows what a first real release can still get
 * wrong down to the two things only a real tag push can prove: GHCR's own permission state and
 * cosign's GitHub OIDC trust exchange.
 */

const workflow = await readFile('.github/workflows/release.yml', 'utf8');

for (const required of [
  "'v*.*.*'",
  'packages: write',
  'id-token: write',
  'component: [api, web, worker]',
  'cosign sign --yes',
  'cosign attest --yes --type cyclonedx',
]) {
  if (!workflow.includes(required)) {
    throw new Error(`.github/workflows/release.yml is missing expected release-pipeline element: ${required}`);
  }
}
console.log('release.yml declares the expected tag trigger, permissions, matrix, and signing steps.');

for (const component of ['api', 'web', 'worker'] as const) {
  const dockerfile = `Dockerfile.${component}`;
  const image = `deliberation-${component}:release-preflight`;
  await execFileAsync('docker', ['build', '--quiet', '--file', dockerfile, '--tag', image, '.'], {
    maxBuffer: 64 * 1024 * 1024,
  });
  await execFileAsync('docker', ['image', 'rm', image]).catch(() => undefined);
  console.log(`${dockerfile} builds successfully (verified with a real, local, non-pushed docker build).`);
}

const sbom = await execFileAsync('npm', ['sbom', '--sbom-format', 'cyclonedx', '--omit=dev'], {
  maxBuffer: 64 * 1024 * 1024,
});
const parsedSbom = JSON.parse(sbom.stdout) as { bomFormat?: unknown; components?: unknown[] };
if (parsedSbom.bomFormat !== 'CycloneDX' || !Array.isArray(parsedSbom.components)) {
  throw new Error('npm sbom did not produce a well-formed CycloneDX document');
}
console.log(`Runtime SBOM generation produces a well-formed CycloneDX document (${parsedSbom.components.length} components).`);

for (const binary of ['cosign', 'docker'] as const) {
  await execFileAsync(binary, ['version']).catch(() => {
    throw new Error(`${binary} is not available; release.yml's signing/build steps cannot be locally reproduced`);
  });
}
console.log('cosign and docker binaries are available for the signing and build steps release.yml performs.');

// GHCR package-write is a repository *setting*, not something a workflow or its default
// GITHUB_TOKEN scope can grant itself — ADR-045 names enabling it as a required, tracked human
// step (Settings -> Actions -> Workflow permissions). This script can only report whether the
// credential it is running with has enough access to read that setting; it never has enough
// access to set it, by design.
const repository = process.env['GITHUB_REPOSITORY'];
if (repository !== undefined) {
  try {
    await execFileAsync('gh', ['api', `repos/${repository}/actions/permissions/workflow`]);
    console.log('Confirmed read access to repository workflow-permission settings.');
  } catch {
    console.log(
      'Could not confirm GHCR package-write is enabled from this credential (expected: this is a human-only '
      + 'repository setting per ADR-045, not something CI or this script can grant). Verify manually under '
      + 'Settings -> Actions -> General -> Workflow permissions before cutting a release tag.',
    );
  }
}

console.log(
  'Release-readiness preflight passed: build, SBOM, and signing tooling are proven locally. '
  + 'Cutting the real v0.1.0 tag and verifying the live GHCR push/cosign-verify/SBOM-attestation '
  + 'chain remains a deliberate, separately authorized step (ADR-045).',
);
