import { describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/shared/domain/index.js';
import { DeliberationCase } from '../../src/deliberation/domain/index.js';
import { ScenarioTree } from '../../src/scenario-planning/domain/index.js';
import { EvaluationRun } from '../../src/evaluation/domain/index.js';

const clock = new FixedClock(new Date('2026-01-01'));
const manifest = {
  deliberationRevisionHash: 'd', preferenceSnapshotHashes: ['p'], evidenceSnapshotHashes: ['e'],
  policyVersion: 'p', safetyCaseVersion: 's', routingPolicyVersion: 'm', connectorSchemaHashes: [], reservationId: 'r',
};

describe('deliberation state failures and completion', () => {
  it('rejects malformed scope and enforces terminal transitions', () => {
    expect(DeliberationCase.draft('bad', 't', ' ', clock).ok).toBe(false);
    const created = DeliberationCase.draft('case', 't', 'Title', clock);
    if (!created.ok) throw new Error('fixture failed');
    expect(created.value.scope().ok).toBe(false);
    expect(created.value.defineContract({
      question: '', successDefinition: '', options: [], generateOptions: false,
      constraints: [], stakeholderIds: [], decisionAuthorityId: 'human',
      riskClassificationReference: 'risk', deadline: new Date('2027-01-01'),
    }).ok).toBe(false);
    expect(created.value.defineContract({
      question: 'Q', successDefinition: 'S', options: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
      generateOptions: false, constraints: [], stakeholderIds: [], decisionAuthorityId: 'human',
      riskClassificationReference: 'risk', deadline: new Date('2027-01-01'),
    }).ok).toBe(true);
    expect(created.value.scope().ok).toBe(true);
    expect(created.value.markReady(new Date('2028-01-01')).ok).toBe(false);
    expect(created.value.markReady(clock.now()).ok).toBe(true);
    expect(created.value.requestPlanning('run').ok).toBe(true);
    expect(created.value.requestPlanning('second').ok).toBe(false);
    expect(created.value.attachBrief('brief').ok).toBe(true);
    expect(created.value.recordHumanDecision({
      optionId: 'missing', authorityId: 'human', rationale: 'r', recordedAt: clock.now(),
    }, clock).ok).toBe(false);
    expect(created.value.recordHumanDecision({
      optionId: 'a', authorityId: 'human', rationale: 'r', recordedAt: clock.now(),
    }, clock).ok).toBe(true);
    expect(created.value.close().ok).toBe(true);
    expect(created.value.cancel().ok).toBe(false);
  });

  it('cancels a pre-decision case idempotently only once', () => {
    const created = DeliberationCase.draft('case2', 't', 'Title', clock);
    if (!created.ok) throw new Error('fixture failed');
    expect(created.value.cancel().ok).toBe(true);
    expect(created.value.cancel().ok).toBe(false);
  });
});

describe('scenario lease and lifecycle branches', () => {
  it('allocates lineage, enforces concurrency, cancellation and terminal completion', () => {
    const planned = ScenarioTree.plan('tree', 't', 'root', manifest, {
      branches: 3, depth: 2, tokens: 10, moneyMinorUnits: 10, wallTimeMs: 10, toolCalls: 2, concurrency: 1,
    }, clock);
    if (!planned.ok) throw new Error('fixture failed');
    expect(planned.value.start().ok).toBe(true);
    expect(planned.value.start().ok).toBe(false);
    expect(planned.value.allocateBranch({ id: 'child', parentId: 'root', assumptions: ['a'], modelCorrelationGroup: 'm' }).ok).toBe(true);
    expect(planned.value.lineage('child')).toEqual(['root', 'child']);
    expect(planned.value.lease('root', {
      id: 'l1', tenantId: 't', workerId: 'w', generation: 0, expiresAt: new Date('2027-01-01'),
    }, clock.now()).ok).toBe(true);
    expect(planned.value.lease('child', {
      id: 'l2', tenantId: 't', workerId: 'w2', generation: 0, expiresAt: new Date('2027-01-01'),
    }, clock.now()).ok).toBe(false);
    expect(planned.value.commit('root', 'wrong', 1, 'o', {}, clock.now()).ok).toBe(false);
    expect(planned.value.commit('root', 'l1', 1, 'o', { tokens: 1 }, clock.now()).ok).toBe(true);
    expect(planned.value.complete().ok).toBe(false);
    planned.value.cancel();
    expect(planned.value.state).toBe('cancelled');
    expect(planned.value.allocateBranch({ id: 'late', parentId: 'root', assumptions: [], modelCorrelationGroup: 'm' }).ok).toBe(false);
  });

  it('completes a fully processed root-only tree', () => {
    const planned = ScenarioTree.plan('complete', 't', 'root', manifest, {
      branches: 1, depth: 0, tokens: 10, moneyMinorUnits: 10, wallTimeMs: 10, toolCalls: 1, concurrency: 1,
    }, clock);
    if (!planned.ok) throw new Error('fixture failed');
    planned.value.start();
    planned.value.lease('root', { id: 'l', tenantId: 't', workerId: 'w', generation: 0, expiresAt: new Date('2027-01-01') }, clock.now());
    planned.value.commit('root', 'l', 1, 'o', {}, clock.now());
    expect(planned.value.complete().ok).toBe(true);
  });
});

describe('evaluation verifier and sensitivity branches', () => {
  it('requires stronger verification before model judgment and computes sensitivity', () => {
    const run = EvaluationRun.plan('eval', 't', {
      scenarioManifestHash: 's', evidenceManifestHash: 'e', preferenceManifestHash: 'p', policyManifestHash: 'g',
    }, ['a', 'b'], clock);
    if (!run.ok) throw new Error('fixture failed');
    run.value.start();
    const modelFinding = {
      id: 'model', optionId: 'a', claimId: 'claim', kind: 'model-judgment' as const,
      status: 'pass' as const, evidenceReferences: ['e'], verifierVersion: '1', rationale: 'model',
    };
    expect(run.value.recordFinding(modelFinding).ok).toBe(false);
    expect(run.value.recordFinding({ ...modelFinding, id: 'det', kind: 'deterministic' }).ok).toBe(true);
    expect(run.value.recordFinding(modelFinding).ok).toBe(true);
    expect(run.value.score({
      optionId: 'a', criterionKey: 'value', value: 1, unit: 'u', normalizedUtility: 0.8, weight: 1, rubricVersion: '1',
    }).ok).toBe(true);
    expect(run.value.score({
      optionId: 'a', criterionKey: 'value', value: 1, unit: 'u', normalizedUtility: 0.8, weight: 1, rubricVersion: '1',
    }).ok).toBe(false);
    expect(run.value.score({
      optionId: 'b', criterionKey: 'value', value: 1, unit: 'u', normalizedUtility: 0.4, weight: 1, rubricVersion: '1',
    }).ok).toBe(true);
    expect(run.value.sensitivity([{ value: 1 }, { value: 0 }])).toEqual({ a: 2, b: 0 });
    expect(run.value.complete().ok).toBe(true);
    expect(run.value.state).toBe('completed');
  });
});
