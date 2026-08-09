import { describe, expect, it } from 'vitest';
import { denyUnqualifiedSandbox, type SandboxedExecutionRequest, type SandboxedWorkKind } from '../../src/platform/runtime/index.js';
import { ProductionDependency } from '../../src/integrations/domain/entities/index.js';

const request = (kind: SandboxedWorkKind): SandboxedExecutionRequest => ({
  workId: `work-${kind}`, kind, tenantId: 'tenant-1', region: 'eu-1',
  token: { value: 'short-lived', capabilities: ['connector:read'], expiresAt: new Date('2026-08-09T01:00:00Z') },
  budget: { wallClockMillis: 1_000, costMinorUnits: 10 },
  input: { anything: true },
});

/** ADR-040 qualification record. Stays pre-eligible: nothing exists to qualify against yet. */
const rvmDependency = (): ProductionDependency => new ProductionDependency({
  id: 'rvm-sandbox', version: 1, immutableProviderVersion: 'rvm-src-2026-08-09-f3c1d2e', owner: 'platform-runtime',
  purpose: 'sandboxed-execution', dataClasses: ['internal'], regions: ['eu-1'], retentionDays: 0,
  permitsTraining: false, fixtureHash: 'none', killSwitchId: 'rvm-sandbox',
  exitPlan: 'Not qualifiable today: ruvnet/rvm publishes no prebuilt artifact (releases are source tarballs only), '
    + 'it is bare-metal no-std Rust with no Node binding, and ADR-040 leaves the dispatch mechanism (process, VM, or '
    + 'syscall boundary) undecided. Exit is removal of the unused port binding; no call site depends on it.',
  reviewedAt: new Date('2026-08-09'), expiresAt: new Date('2026-11-09'), driftFingerprint: 'unqualified',
});

describe('ADR-040 sandboxed execution scaffolding', () => {
  it('refuses every dispatch instead of claiming isolated execution', async () => {
    for (const kind of ['connector-tool-call', 'scenario-branch-rollout'] as const) {
      const outcome = await denyUnqualifiedSandbox.execute(request(kind));
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.error.reason).toBe('not-qualified');
      expect(outcome.error.workId).toBe(`work-${kind}`);
    }
  });

  it('keeps the RVM dependency short of eligible and denies its use', () => {
    const dependency = rvmDependency();
    expect(dependency.state).toBe('draft');
    expect(() => dependency.markEligible(true)).toThrow(/evidence/i);

    dependency.startQualification();
    expect(dependency.state).toBe('qualifying');
    const decision = dependency.decide('eu-1', 'internal', new Date('2026-08-09'), 'unqualified');
    expect(decision.ok).toBe(false);
    if (decision.ok) throw new Error('unreachable');
    expect(decision.error.code).toBe('DEPENDENCY_UNAVAILABLE');
    expect(dependency.state).not.toBe('eligible');
  });
});
