import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/**
 * ADR-043: dependencies integrated as scaffolding-only because they have never published a
 * runnable artifact. Each entry records what would have to appear for the corresponding ADR to
 * be re-opened for a real qualification pass. Add an entry whenever a dependency is integrated
 * behind a port for this reason; remove one once its ADR has been re-evaluated.
 */
export interface ArtifactlessDependency {
  readonly id: string;
  readonly repo: string;
  readonly npmPackage: string | undefined;
  /** `any`: any published release qualifies. `with-asset`: source tarballs alone do not. */
  readonly releaseQualifies: 'any' | 'with-asset';
  readonly requires: string;
  readonly adr: string;
}

export const REGISTRY: readonly ArtifactlessDependency[] = [
  {
    id: 'rulake',
    repo: 'ruvnet/RuLake',
    npmPackage: 'rulake',
    releaseQualifies: 'any',
    requires: 'a GitHub release OR an npm package',
    adr: 'ADR-038',
  },
  {
    id: 'rvm',
    repo: 'ruvnet/rvm',
    npmPackage: undefined,
    releaseQualifies: 'with-asset',
    requires: 'a GitHub release with a binary/library asset, or an npm package',
    adr: 'ADR-040',
  },
];

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type CommandRunner = (command: string, args: readonly string[]) => Promise<CommandResult>;

export interface CheckReport {
  /** Artifacts that now exist and did not before — each one blocks, naming what to re-evaluate. */
  readonly findings: readonly string[];
  /** Transient or ambiguous external state; reported but never blocking (ADR-043 fail-soft). */
  readonly warnings: readonly string[];
  readonly unchanged: readonly string[];
}

interface Release {
  readonly tag: string;
  readonly assetNames: readonly string[];
}

export const execFileRunner: CommandRunner = (command, args) =>
  new Promise((resolve) => {
    execFile(command, [...args], { maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      const exitCode = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
      resolve({ exitCode, stdout, stderr });
    });
  });

export async function checkArtifactAvailability(
  runner: CommandRunner,
  registry: readonly ArtifactlessDependency[] = REGISTRY,
): Promise<CheckReport> {
  const findings: string[] = [];
  const warnings: string[] = [];
  const unchanged: string[] = [];

  for (const entry of registry) {
    const releases = await runner('gh', ['api', `repos/${entry.repo}/releases`]);
    if (releases.exitCode !== 0) {
      warnings.push(
        `${entry.id}: could not read releases for ${entry.repo} (gh exited ${releases.exitCode}); ` +
          `treating as unchanged. If the repository moved, update the ADR-043 registry. ${firstLine(releases.stderr)}`,
      );
      continue;
    }
    const parsed = parseReleases(releases.stdout);
    if (parsed === undefined) {
      warnings.push(`${entry.id}: unreadable releases payload for ${entry.repo}; treating as unchanged.`);
      continue;
    }
    const qualifying = parsed.filter((release) =>
      entry.releaseQualifies === 'any' ? true : release.assetNames.length > 0,
    );
    const first = qualifying[0];
    if (first !== undefined) {
      findings.push(
        `${entry.repo} published its first qualifying release: ${first.tag}` +
          (first.assetNames.length > 0 ? `, containing ${first.assetNames.join(', ')}` : '') +
          ` — re-evaluate ${entry.adr} (requires ${entry.requires}).`,
      );
      continue;
    }

    if (entry.npmPackage === undefined) {
      unchanged.push(`${entry.id}: no qualifying GitHub release on ${entry.repo}; still ${entry.requires}.`);
      continue;
    }
    const published = await runner('npm', ['view', entry.npmPackage, 'version']);
    if (published.exitCode === 0 && published.stdout.trim().length > 0) {
      findings.push(
        `npm package '${entry.npmPackage}' now publishes version ${published.stdout.trim()}` +
          ` — re-evaluate ${entry.adr} (requires ${entry.requires}).`,
      );
      continue;
    }
    // `npm view` exits non-zero for an unpublished package (E404) and for a registry outage
    // alike; only the former is a real negative result, so anything else is reported soft.
    if (published.exitCode !== 0 && !/E404|404 Not Found/.test(published.stderr)) {
      warnings.push(
        `${entry.id}: could not read npm package '${entry.npmPackage}' (npm exited ${published.exitCode}); ` +
          `treating as unchanged. ${firstLine(published.stderr)}`,
      );
      continue;
    }
    unchanged.push(
      `${entry.id}: no qualifying GitHub release on ${entry.repo} and no published npm package ` +
        `'${entry.npmPackage}'; still ${entry.requires}.`,
    );
  }

  return { findings, warnings, unchanged };
}

function parseReleases(stdout: string): readonly Release[] | undefined {
  let payload: unknown;
  try {
    payload = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (!Array.isArray(payload)) return undefined;
  const releases: Release[] = [];
  for (const item of payload) {
    if (typeof item !== 'object' || item === null) return undefined;
    const record = item as Record<string, unknown>;
    if (record['draft'] === true) continue;
    const assets = Array.isArray(record['assets']) ? record['assets'] : [];
    releases.push({
      tag: typeof record['tag_name'] === 'string' ? record['tag_name'] : '(untagged)',
      assetNames: assets.flatMap((asset) => {
        const name = (asset as Record<string, unknown> | null)?.['name'];
        return typeof name === 'string' ? [name] : [];
      }),
    });
  }
  return releases;
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0] ?? '';
}

export async function main(runner: CommandRunner = execFileRunner): Promise<number> {
  const report = await checkArtifactAvailability(runner);
  for (const line of report.unchanged) console.log(`artifact-availability: ${line}`);
  for (const line of report.warnings) console.warn(`artifact-availability WARNING: ${line}`);
  if (report.findings.length === 0) {
    console.log(
      `artifact-availability: unchanged — no artifactless dependency (${REGISTRY.map((entry) => entry.id).join(', ')}) has published anything to qualify against (ADR-043).`,
    );
    return 0;
  }
  for (const finding of report.findings) console.error(`artifact-availability FINDING: ${finding}`);
  console.error(
    'A dependency integrated as scaffolding-only now has a runnable artifact. It does not auto-integrate: re-open the named ADR for a real qualification pass (ADR-043).',
  );
  return 1;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  process.exitCode = await main();
}
