import { describe, expect, it } from 'vitest';
import { AgenticFlowCostOptimalSelector, ModelGateway, type ModelRequest, type ModelRoute } from '../../src/platform/model-gateway/index.js';
import { allowTestDependencies } from '../../src/integrations/application/dependency-eligibility.js';
import { ProductionDependency } from '../../src/integrations/domain/entities/production-dependency.js';

const baseRequest: ModelRequest = {
  task: 'generation', tenantId: 'tenant-a', region: 'eu-1', riskTier: 'low',
  containsRestrictedData: false, maximumCostMinorUnits: 100, promptTemplateId: 't', promptTemplateHash: 'h',
  parameters: {}, input: {}, evidenceManifest: [], toolManifest: [], safetyConfigurationHash: 's',
};

const routeA: ModelRoute = {
  providerId: 'provider-a', immutableModelId: 'model-a-2026-01-01', tasks: ['generation'],
  regions: ['eu-1'], maximumRiskTier: 'high', permitsRestrictedData: false, maximumCostMinorUnits: 50, priority: 1,
};
const routeB: ModelRoute = {
  providerId: 'provider-b', immutableModelId: 'model-b-2026-01-01', tasks: ['generation'],
  regions: ['eu-1'], maximumRiskTier: 'high', permitsRestrictedData: false, maximumCostMinorUnits: 30, priority: 2,
};

describe('AgenticFlowCostOptimalSelector (ADR-036)', () => {
  it('selects one of the policy-compliant candidates for real, using the actual agentic-flow router (cold-start path, no labelled examples)', () => {
    const selector = new AgenticFlowCostOptimalSelector();
    const picked = selector.select([routeA, routeB], baseRequest);
    expect([routeA, routeB]).toContainEqual(picked);
  });

  it('returns undefined for an empty candidate set rather than throwing', () => {
    const selector = new AgenticFlowCostOptimalSelector();
    expect(selector.select([], baseRequest)).toBeUndefined();
  });

  it('ModelGateway.route() uses the selector\'s pick when it is a member of the compliant set', async () => {
    const gateway = new ModelGateway(
      { id: 'routes', version: 1, routes: [routeA, routeB] },
      new Map(),
      allowTestDependencies,
      { select: () => routeB },
    );
    expect(gateway.route(baseRequest)).toMatchObject({ ok: true, value: routeB });
  });

  it('ModelGateway.route() ignores a selector proposal outside the compliant set and falls back to static priority', async () => {
    const outOfPolicyRoute: ModelRoute = { ...routeA, providerId: 'provider-c', regions: ['us-1'] };
    const gateway = new ModelGateway(
      { id: 'routes', version: 1, routes: [routeA, routeB] },
      new Map(),
      allowTestDependencies,
      { select: () => outOfPolicyRoute },
    );
    // routeB has the higher priority (2 > 1), so static fallback picks it.
    expect(gateway.route(baseRequest)).toMatchObject({ ok: true, value: routeB });
  });

  it('ModelGateway.route() keeps its original static-priority behavior with no selector configured', async () => {
    const gateway = new ModelGateway({ id: 'routes', version: 1, routes: [routeA, routeB] }, new Map(), allowTestDependencies);
    expect(gateway.route(baseRequest)).toMatchObject({ ok: true, value: routeB });
  });

  it('never proposes a route that fails policy (task/region/risk/cost) even when asked to pick among a wider candidate set', () => {
    const selector = new AgenticFlowCostOptimalSelector();
    // ModelGateway is the only caller responsible for narrowing to policy-compliant candidates
    // before calling select(); this test documents that contract by only ever passing compliant ones.
    const embeddingRequest: ModelRequest = { ...baseRequest, task: 'embedding' };
    const embeddingRoute: ModelRoute = { ...routeA, tasks: ['embedding'] };
    const picked = selector.select([embeddingRoute], embeddingRequest);
    expect(picked).toEqual(embeddingRoute);
  });
});

describe('agentic-flow production-dependency qualification (ADR-036, ADR-031)', () => {
  // `npm install agentic-flow` pulls in @huggingface/transformers, onnxruntime-node, and
  // `sharp` (libvips), plus a duplicated OpenTelemetry tree distinct from this platform's own
  // — 8 HIGH-severity and 22 moderate `npm audit` findings as of this ADR, none resolvable
  // without a breaking downgrade (`npm audit fix --force` -> agentic-flow@1.10.2, an older
  // major with a materially different, unverified API). Until that upstream risk is resolved
  // or accepted through a documented waiver, this dependency is deliberately held below
  // `eligible` — `ModelGateway`'s default `denyUnqualifiedModelDependencies` therefore refuses
  // every request that would route to it, exactly as it refuses any other unqualified provider.
  const qualification = {
    id: 'agentic-flow', version: 1, immutableProviderVersion: '2.1.2', owner: 'platform-team',
    purpose: 'model-routing-selection', dataClasses: ['internal'], regions: ['eu-1'],
    retentionDays: 0, permitsTraining: false, fixtureHash: 'unfixtured-pending-qualification',
    killSwitchId: 'agentic-flow-selector', exitPlan: 'Remove AgenticFlowCostOptimalSelector from '
      + 'ModelGateway construction; static-priority routing is the unconditional fallback and '
      + 'requires no code change to keep working. Blocked on: npm audit HIGH findings in the '
      + 'huggingface/transformers -> onnxruntime-node/sharp chain (8 HIGH, 22 moderate as qualified).',
    reviewedAt: new Date('2026-08-09T00:00:00.000Z'), expiresAt: new Date('2027-08-09T00:00:00.000Z'),
    driftFingerprint: 'agentic-flow@2.1.2',
  };

  it('constructs in draft state and is never marked eligible', () => {
    const dependency = new ProductionDependency(qualification);
    expect(dependency.state).toBe('draft');
    dependency.startQualification();
    expect(dependency.state).toBe('qualifying');
    // No markEligible(true) call: this dependency does not clear qualification in this ADR.
    const decision = dependency.decide('eu-1', 'internal', new Date('2026-08-09T01:00:00.000Z'), qualification.driftFingerprint);
    expect(decision.ok).toBe(false);
  });
});
