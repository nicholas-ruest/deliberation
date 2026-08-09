import { describe, expect, it } from 'vitest';
import {
  checkArtifactAvailability,
  REGISTRY,
  type ArtifactlessDependency,
  type CommandResult,
  type CommandRunner,
} from '../../scripts/check-artifactless-dependencies.js';

function ok(stdout: string): CommandResult {
  return { exitCode: 0, stdout, stderr: '' };
}

/**
 * Stands in for `gh`/`npm` so the check is exercised without network access. Anything the check
 * asks for that the fixture does not describe answers the way the real tools answer for an
 * empty/unpublished target, so an unregistered repo can never accidentally produce a finding.
 */
function stubRunner(fixture: {
  releases?: Readonly<Record<string, string>>;
  npmVersions?: Readonly<Record<string, string>>;
}): { runner: CommandRunner; calls: string[] } {
  const calls: string[] = [];
  const runner: CommandRunner = async (command, args) => {
    calls.push([command, ...args].join(' '));
    if (command === 'gh') {
      const repo = args[args.length - 1]?.replace(/^repos\//, '').replace(/\/releases$/, '') ?? '';
      return ok(fixture.releases?.[repo] ?? '[]');
    }
    if (command === 'npm') {
      const pkg = args[1] ?? '';
      const version = fixture.npmVersions?.[pkg];
      return version === undefined
        ? { exitCode: 1, stdout: '', stderr: `npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/${pkg}` }
        : ok(`${version}\n`);
    }
    throw new Error(`unexpected command ${command}`);
  };
  return { runner, calls };
}

const rulake = REGISTRY.find((entry) => entry.id === 'rulake') as ArtifactlessDependency;
const rvm = REGISTRY.find((entry) => entry.id === 'rvm') as ArtifactlessDependency;

describe('ADR-043 artifactless dependency re-check', () => {
  it('reports unchanged with no findings when neither dependency has published anything', async () => {
    const { runner } = stubRunner({});
    const report = await checkArtifactAvailability(runner);
    expect(report.findings).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.unchanged).toHaveLength(REGISTRY.length);
  });

  it('flags a first RuLake release naming the ADR to re-evaluate', async () => {
    const { runner } = stubRunner({
      releases: { 'ruvnet/RuLake': JSON.stringify([{ tag_name: 'v0.1.0', assets: [] }]) },
    });
    const report = await checkArtifactAvailability(runner, [rulake]);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toContain('ruvnet/RuLake published its first qualifying release: v0.1.0');
    expect(report.findings[0]).toContain('ADR-038');
  });

  it('flags a published npm package even when the repository still has no release', async () => {
    const { runner } = stubRunner({ npmVersions: { rulake: '0.2.1' } });
    const report = await checkArtifactAvailability(runner, [rulake]);
    expect(report.findings).toEqual([
      expect.stringContaining("npm package 'rulake' now publishes version 0.2.1"),
    ]);
  });

  it('ignores an RVM release that carries no binary or library asset', async () => {
    // RVM's existing releases are source tarballs, which GitHub exposes via tarball_url rather
    // than as assets: the finding ADR-040 recorded, and still not something to qualify against.
    const { runner } = stubRunner({
      releases: { 'ruvnet/rvm': JSON.stringify([{ tag_name: 'v0.3.0', assets: [] }]) },
    });
    const report = await checkArtifactAvailability(runner, [rvm]);
    expect(report.findings).toEqual([]);
    expect(report.unchanged).toHaveLength(1);
  });

  it('flags an RVM release once it carries a built asset', async () => {
    const { runner } = stubRunner({
      releases: {
        'ruvnet/rvm': JSON.stringify([{ tag_name: 'v0.3.0', assets: [{ name: 'rvm-linux-x64' }] }]),
      },
    });
    const report = await checkArtifactAvailability(runner, [rvm]);
    expect(report.findings).toEqual([
      expect.stringContaining('rvm-linux-x64'),
    ]);
    expect(report.findings[0]).toContain('ADR-040');
  });

  it('ignores releases on repositories that are not in the registry', async () => {
    const { runner, calls } = stubRunner({
      releases: {
        'ruvnet/some-other-project': JSON.stringify([{ tag_name: 'v9.9.9', assets: [{ name: 'binary' }] }]),
      },
      npmVersions: { 'some-unrelated-package': '1.0.0' },
    });
    const report = await checkArtifactAvailability(runner);
    expect(report.findings).toEqual([]);
    expect(calls.some((call) => call.includes('some-other-project'))).toBe(false);
    expect(calls.some((call) => call.includes('some-unrelated-package'))).toBe(false);
  });

  it('skips draft releases, which are not published artifacts', async () => {
    const { runner } = stubRunner({
      releases: {
        'ruvnet/RuLake': JSON.stringify([{ tag_name: 'v0.1.0', draft: true, assets: [] }]),
      },
    });
    const report = await checkArtifactAvailability(runner, [rulake]);
    expect(report.findings).toEqual([]);
  });

  it('warns without a finding when the release API is unreachable', async () => {
    const runner: CommandRunner = async (command) =>
      command === 'gh'
        ? { exitCode: 1, stdout: '', stderr: 'error connecting to api.github.com' }
        : ok('');
    const report = await checkArtifactAvailability(runner, [rvm]);
    expect(report.findings).toEqual([]);
    expect(report.warnings[0]).toContain('could not read releases for ruvnet/rvm');
  });

  it('warns without a finding when npm fails for a reason other than a missing package', async () => {
    const runner: CommandRunner = async (command) =>
      command === 'gh' ? ok('[]') : { exitCode: 1, stdout: '', stderr: 'npm error network ETIMEDOUT' };
    const report = await checkArtifactAvailability(runner, [rulake]);
    expect(report.findings).toEqual([]);
    expect(report.warnings[0]).toContain("could not read npm package 'rulake'");
  });
});
