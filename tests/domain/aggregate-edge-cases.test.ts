import { describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/shared/domain/index.js';
import { ProductPlan, CustomerContract, Entitlement } from '../../src/commercial-operations/domain/index.js';
import { PreferenceProfile, analyzePreferenceConflict } from '../../src/preferences/domain/index.js';
import { EvidenceRecord } from '../../src/evidence/domain/index.js';
import { EncryptedInMemoryObjectStore } from '../../src/platform/persistence/index.js';
import { OutcomeRecord } from '../../src/learning/domain/index.js';
import { DecisionBrief, EvaluationRun } from '../../src/evaluation/domain/index.js';
import { ScenarioTree } from '../../src/scenario-planning/domain/index.js';

const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));

describe('commercial aggregate edges', () => {
  it('validates and publishes product plans and customer contracts', () => {
    expect(ProductPlan.draft('p', ['a', 'a'], new Date('2027-01-01'), clock).ok).toBe(false);
    const plan = ProductPlan.draft('p', ['planning'], new Date('2027-01-01'), clock);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.value.publish(clock.now()).ok).toBe(true);
    const invalid = new CustomerContract('c1', 't', clock.now(), 'p', new Date('2027-02-01'), new Date('2027-01-01'), {});
    expect(invalid.activate(clock.now()).ok).toBe(false);
    const contract = new CustomerContract('c2', 't', clock.now(), 'p', new Date('2026-01-01'), new Date('2027-01-01'), {});
    expect(contract.activate(clock.now()).ok).toBe(true);
    contract.terminate();
    expect(contract.state).toBe('terminated');
  });

  it('rejects expired, noninteger and conflicting usage replays', () => {
    const entitlement = Entitlement.create('e', 't', ['feature'], clock);
    for (const dimension of ['tokens', 'moneyMinorUnits', 'toolCalls', 'branches', 'wallTimeMs', 'concurrency'] as const) {
      entitlement.setQuota(dimension, { hardLimit: 10, allowOverage: false });
    }
    const request = { tokens: 2, moneyMinorUnits: 2, toolCalls: 2, branches: 2, wallTimeMs: 2, concurrency: 1 };
    expect(entitlement.reserve('expired', request, new Date('2025-01-01')).ok).toBe(false);
    expect(entitlement.reserve('fractional', { ...request, tokens: 1.5 }, new Date('2027-01-01')).ok).toBe(false);
    expect(entitlement.reserve('r', request, new Date('2027-01-01')).ok).toBe(true);
    const receipt = { id: 'u', reservationId: 'r', dimension: 'tokens' as const, quantity: 1, sourceReference: 'provider:1', occurredAt: clock.now() };
    expect(entitlement.consume(receipt).ok).toBe(true);
    expect(entitlement.consume({ ...receipt, quantity: 2 }).ok).toBe(false);
    expect(entitlement.release('r').ok).toBe(true);
    expect(entitlement.release('r').ok).toBe(true);
    expect(entitlement.release('missing').ok).toBe(false);
    expect(entitlement.hasFeature('feature')).toBe(true);
  });
});

describe('preference and evidence edges', () => {
  it('confirms suggestions, updates weights and detects veto conflicts', () => {
    const a = PreferenceProfile.create('a', 't', 'a', clock);
    expect(a.addCriterion({ key: 'risk', label: 'Risk', unit: 'score', weight: 1, state: 'suggested', inferenceProvenance: 'model' }).ok).toBe(true);
    expect(a.confirmCriterion('risk').ok).toBe(true);
    expect(a.setWeight('risk', 2).ok).toBe(true);
    expect(a.setWeight('missing', 1).ok).toBe(false);
    a.addVeto({ key: 'law', predicate: 'allowed', rationale: 'law' });
    const b = PreferenceProfile.create('b', 't', 'b', clock);
    b.addCriterion({ key: 'risk', label: 'Risk', unit: 'score', weight: 1, state: 'confirmed' });
    b.addVeto({ key: 'law', predicate: 'forbidden', rationale: 'law' });
    const snapshots = [a.publish(clock), b.publish(clock)];
    expect(snapshots.every((snapshot) => snapshot.ok)).toBe(true);
    if (snapshots[0]?.ok && snapshots[1]?.ok) {
      expect(analyzePreferenceConflict([snapshots[0].value, snapshots[1].value])).toEqual(['law']);
    }
  });

  it('versions claims, verification, restriction, snapshots and supersession', async () => {
    const store = EncryptedInMemoryObjectStore.forTests();
    const artifact = await store.put(Buffer.from('source'), {
      tenantId: 't', purpose: 'case', sensitivity: 'restricted', retentionPolicyId: 'r',
    });
    if (!artifact.ok) throw new Error('fixture failed');
    const record = EvidenceRecord.ingest({
      id: 'e', tenantId: 't', artifact: artifact.value, sourceLocator: 'https://source',
      capturedAt: clock.now(), epistemicClass: 'external-claim', sensitivity: 'confidential',
      purposes: ['case'], retentionPolicyId: 'r', provenance: [{ kind: 'source', reference: 'source' }],
    }, clock);
    if (!record.ok) throw new Error('fixture failed');
    expect(record.value.addClaim({ id: 'claim', text: 'text', status: 'unverified' }).ok).toBe(true);
    expect(record.value.addClaim({ id: 'claim', text: 'duplicate', status: 'unverified' }).ok).toBe(false);
    expect(record.value.verify('', true).ok).toBe(false);
    expect(record.value.verify('verifier', true).ok).toBe(true);
    expect(record.value.restrict('restricted').ok).toBe(true);
    expect(record.value.restrict('public').ok).toBe(false);
    expect(record.value.permits('case')).toBe(true);
    expect(record.value.supersede('e2', new Set()).ok).toBe(true);
    expect(record.value.supersede('e3', new Set()).ok).toBe(false);
    expect(record.value.snapshot()['verificationStatus']).toBe('verified');
  });
});

describe('outcome, evaluation and scenario edges', () => {
  it('records and supersedes qualified observations', () => {
    const outcome = OutcomeRecord.open('o', 't', 'd', clock);
    expect(outcome.addPrediction({
      id: 'p', optionId: 'a', measure: 'm', predictedValue: 1, unit: 'u', madeAt: new Date('2025-12-01'),
    }, new Date('2026-01-01')).ok).toBe(true);
    expect(outcome.observe({
      id: 'o1', measure: 'm', value: 1, unit: 'u', observedAt: clock.now(), capturedAt: clock.now(),
      provenanceReference: 'receipt', epistemicClass: 'observed-fact',
    }, true).ok).toBe(true);
    expect(outcome.observe({
      id: 'o2', measure: 'm', value: 2, unit: 'u', observedAt: clock.now(), capturedAt: clock.now(),
      provenanceReference: 'correction', epistemicClass: 'observed-fact', supersedesId: 'o1',
    }, true).ok).toBe(true);
    expect(outcome.finalize().ok).toBe(true);
    expect(outcome.cohortObservations().map(({ id }) => id)).toEqual(['o2']);
    outcome.excludeFromLearning();
    expect(outcome.cohortObservations()).toEqual([]);
  });

  it('abstains on unnormalized scorecards and publishes immutable cited briefs', () => {
    const run = EvaluationRun.plan('e', 't', {
      scenarioManifestHash: 's', evidenceManifestHash: 'e', preferenceManifestHash: 'p', policyManifestHash: 'g',
    }, ['a'], clock);
    if (!run.ok) throw new Error('fixture failed');
    run.value.start();
    run.value.score({ optionId: 'a', criterionKey: 'c', value: 1, unit: 'u', normalizedUtility: 1, weight: 0.5, rubricVersion: '1' });
    expect(run.value.complete().ok).toBe(true);
    expect(run.value.state).toBe('abstained');
    const brief = DecisionBrief.compose('b', 't', 'e', {
      eligibleOptions: ['a'], paretoOptions: ['a'], assumptions: ['assumption'],
      materialClaims: [{ text: 'claim', evidenceReferences: ['evidence'] }], dissent: [],
      sensitivitySummary: 'stable', limitations: ['limit'], callToAction: 'An authorized human should decide',
    }, clock);
    if (!brief.ok) throw new Error('fixture failed');
    expect(brief.value.publish().ok).toBe(true);
    expect(brief.value.publish().ok).toBe(false);
    expect(brief.value.supersede('b2').ok).toBe(true);
  });

  it('enforces root-inclusive budgets and atomic invalid usage', () => {
    const one = ScenarioTree.plan('tree', 't', 'root', {
      deliberationRevisionHash: 'd', preferenceSnapshotHashes: ['p'], evidenceSnapshotHashes: ['e'],
      policyVersion: 'p', safetyCaseVersion: 's', routingPolicyVersion: 'm', connectorSchemaHashes: [], reservationId: 'r',
    }, { branches: 1, depth: 1, tokens: 10, moneyMinorUnits: 10, wallTimeMs: 10, toolCalls: 1, concurrency: 1 }, clock);
    if (!one.ok) throw new Error('fixture failed');
    one.value.start();
    expect(one.value.allocateBranch({ id: 'child', parentId: 'root', assumptions: [], modelCorrelationGroup: 'g' }).ok).toBe(false);
    expect(one.value.state).toBe('budget-exhausted');
  });
});
