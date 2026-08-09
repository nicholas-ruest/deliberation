import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function runCheck(
  root: string,
  flaggedOverride: string,
  riskAcceptanceOverride?: Readonly<Record<string, { approvedBy: string; requestedBy: string; expiresAt: string }>>,
): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/check-dependency-qualification.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DEPENDENCY_QUALIFICATION_ROOT: root,
      DEPENDENCY_QUALIFICATION_FLAGGED_OVERRIDE: flaggedOverride,
      ...(riskAcceptanceOverride === undefined ? {} : { DEPENDENCY_QUALIFICATION_RISK_ACCEPTANCE_OVERRIDE: JSON.stringify(riskAcceptanceOverride) }),
    },
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe('ADR-041 dependency-qualification enforcement', () => {
  it('fails when a registered dependency is marked eligible while npm audit still flags it', () => {
    const { status, output } = runCheck('tests/fixtures/dependency-qualification/violation', 'agentdb');
    expect(status).not.toBe(0);
    expect(output).toContain("marks dependency 'agentdb' eligible");
    expect(output).toContain('ADR-041');
  });

  it('passes when the flagged dependency id never appears near a markEligible(true) call', () => {
    const { status, output } = runCheck('tests/fixtures/dependency-qualification/clean', 'agentdb');
    expect(status).toBe(0);
    expect(output).toContain('policy passed');
  });

  it('passes the same violation fixture once the dependency is no longer flagged', () => {
    // Same fixture as the first test, but nothing is flagged this time: proves the gate tracks
    // current audit state, not a permanent block, per ADR-041's "the exit path costs nothing".
    const { status, output } = runCheck('tests/fixtures/dependency-qualification/violation', '');
    expect(status).toBe(0);
    expect(output).toContain('policy passed');
  });

  it('ignores a dependency id not present in the registry, even if flagged', () => {
    const { status, output } = runCheck('tests/fixtures/dependency-qualification/violation', 'some-unrelated-package');
    expect(status).toBe(0);
    expect(output).toContain('policy passed');
  });
});

describe('ADR-042 risk-acceptance path', () => {
  it('passes a violation fixture when a valid, unexpired, distinctly-approved acceptance is on file', () => {
    const { status, output } = runCheck('tests/fixtures/dependency-qualification/violation', 'agentdb', {
      agentdb: { requestedBy: 'alice', approvedBy: 'bob', expiresAt: '2099-01-01T00:00:00.000Z' },
    });
    expect(status).toBe(0);
    expect(output).toContain('valid risk acceptance on file');
  });

  it('still fails when the recorded acceptance is self-approved', () => {
    const { status, output } = runCheck('tests/fixtures/dependency-qualification/violation', 'agentdb', {
      agentdb: { requestedBy: 'alice', approvedBy: 'alice', expiresAt: '2099-01-01T00:00:00.000Z' },
    });
    expect(status).not.toBe(0);
    expect(output).toContain('no valid risk acceptance');
  });

  it('still fails when the recorded acceptance has expired', () => {
    const { status, output } = runCheck('tests/fixtures/dependency-qualification/violation', 'agentdb', {
      agentdb: { requestedBy: 'alice', approvedBy: 'bob', expiresAt: '2020-01-01T00:00:00.000Z' },
    });
    expect(status).not.toBe(0);
    expect(output).toContain('no valid risk acceptance');
  });

  it('does not let an acceptance for one dependency cover a different one', () => {
    const { status, output } = runCheck('tests/fixtures/dependency-qualification/violation', 'agentdb', {
      'agentic-flow': { requestedBy: 'alice', approvedBy: 'bob', expiresAt: '2099-01-01T00:00:00.000Z' },
    });
    expect(status).not.toBe(0);
    expect(output).toContain("marks dependency 'agentdb' eligible");
  });
});
