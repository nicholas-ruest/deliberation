import { readFile } from 'node:fs/promises';

const semver =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const manifest = JSON.parse(await readFile('package.json', 'utf8')) as { version?: unknown };
const version = manifest.version;
if (typeof version !== 'string' || !semver.test(version)) {
  throw new Error(`package.json version is not valid semantic versioning: ${String(version)}`);
}

const releaseTag = process.env['RELEASE_TAG']?.trim();
if (releaseTag === undefined || releaseTag === '') {
  console.log(`package.json version ${version} is valid semantic versioning.`);
} else {
  if (releaseTag !== `v${version}`) {
    throw new Error(
      `Release tag ${releaseTag} does not match package.json version ${version}; expected tag v${version}`,
    );
  }
  const changelog = await readFile('CHANGELOG.md', 'utf8');
  if (!changelog.includes(`## [${version}]`)) {
    throw new Error(`CHANGELOG.md has no released section for version ${version}`);
  }
  console.log(`Release tag ${releaseTag} matches package.json version ${version} and CHANGELOG.md.`);
}
