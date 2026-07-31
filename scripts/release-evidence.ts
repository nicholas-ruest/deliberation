import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const outputPath = resolve(process.argv[2] ?? 'artifacts/evidence/source-receipt.json');
const excludedPrefixes = [
  '.git/', '.claude-flow/', '.swarm/', 'node_modules/', 'dist/', 'coverage/', 'artifacts/evidence/',
];
const names = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .filter((name) => !excludedPrefixes.some((prefix) => name.startsWith(prefix)))
  .sort();

const files: { path: string; sha256: string; bytes: number }[] = [];
for (const name of names) {
  const metadata = await lstat(resolve(name));
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`Release source contains non-regular file: ${name}`);
  const content = await readFile(resolve(name));
  files.push({
    path: name,
    sha256: createHash('sha256').update(content).digest('hex'),
    bytes: content.byteLength,
  });
}
const snapshotDigest = createHash('sha256')
  .update(files.map(({ path, sha256 }) => `${path}\0${sha256}\n`).join(''))
  .digest('hex');
const receipt = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  source: {
    head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirty: execFileSync('git', ['status', '--porcelain=v1'], { encoding: 'utf8' }).trim().length > 0,
    snapshotDigest,
    fileCount: files.length,
    files,
  },
  runtime: {
    node: process.version,
    npm: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(),
    platform: process.platform,
    architecture: process.arch,
  },
  qualification: {
    level: 'local',
    externalClaimsPermitted: false,
  },
  boundInputs: Object.fromEntries(await Promise.all([
    'package-lock.json',
    'config/operations/release-policy.json',
    'config/operations/prohibited-shortcuts.json',
    'contracts/openapi/v1/openapi.yaml',
    'contracts/asyncapi/v1/asyncapi.yaml',
  ].map(async (path) => [path, createHash('sha256').update(await readFile(path)).digest('hex')]))),
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'w' });
console.log(`Wrote source receipt ${snapshotDigest} for ${files.length} files to ${outputPath}`);
