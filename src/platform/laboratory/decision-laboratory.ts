import { randomUUID } from 'node:crypto';
import type { Clock } from '../../shared/domain/clock.js';
import type { Result } from '../../shared/domain/result.js';
import { DeliberationCase, type DecisionContract } from '../../deliberation/domain/entities/deliberation-case.js';
import { PreferenceProfile, type Criterion, type Veto } from '../../preferences/domain/entities/preference-profile.js';
import { ScenarioTree, type PlanningBudget } from '../../scenario-planning/domain/entities/scenario-tree.js';
import { DecisionBrief, EvaluationRun, type CriterionScore, type VerificationFinding } from '../../evaluation/domain/index.js';

export interface LaboratoryInput {
  readonly tenantId: string;
  readonly title: string;
  readonly contract: DecisionContract;
  readonly stakeholderId: string;
  readonly criteria: readonly Criterion[];
  readonly vetoes: readonly Veto[];
  readonly evidenceSnapshotHashes: readonly string[];
  readonly policyVersion: string;
  readonly safetyCaseVersion: string;
  readonly routingPolicyVersion: string;
  readonly reservationId: string;
  readonly budget: PlanningBudget;
  readonly findings: readonly (VerificationFinding & { readonly hardConstraint?: boolean })[];
  readonly scores: readonly CriterionScore[];
  readonly assumptions: readonly string[];
  readonly limitations: readonly string[];
}

export interface LaboratoryResult {
  readonly deliberation: DeliberationCase;
  readonly scenarioTree: ScenarioTree;
  readonly evaluation: EvaluationRun;
  readonly brief: DecisionBrief;
}

export class DecisionLaboratory {
  constructor(private readonly clock: Clock) {}

  run(input: LaboratoryInput): Result<LaboratoryResult> {
    if (input.evidenceSnapshotHashes.length === 0) {
      return { ok: false, error: { code: 'ABSTAINED', message: 'Material evidence is missing', details: { unblock: 'Provide provenance-bearing evidence' } } };
    }
    const drafted = DeliberationCase.draft(randomUUID(), input.tenantId, input.title, this.clock);
    if (!drafted.ok) return drafted;
    const deliberation = drafted.value;
    const defined = deliberation.defineContract(input.contract);
    if (!defined.ok) return defined;
    const scoped = deliberation.scope();
    if (!scoped.ok) return scoped;
    const ready = deliberation.markReady(this.clock.now());
    if (!ready.ok) return ready;

    const profile = PreferenceProfile.create(randomUUID(), input.tenantId, input.stakeholderId, this.clock);
    for (const criterion of input.criteria) {
      const added = profile.addCriterion(criterion);
      if (!added.ok) return added;
    }
    for (const veto of input.vetoes) {
      const added = profile.addVeto(veto);
      if (!added.ok) return added;
    }
    const preference = profile.publish(this.clock);
    if (!preference.ok) return preference;

    const runId = randomUUID();
    const requested = deliberation.requestPlanning(runId);
    if (!requested.ok) return requested;
    const rootBranchId = randomUUID();
    const treeResult = ScenarioTree.plan(runId, input.tenantId, rootBranchId, {
      deliberationRevisionHash: `${deliberation.id}:${deliberation.revision}`,
      preferenceSnapshotHashes: [`${preference.value.profileId}:${preference.value.profileVersion}`],
      evidenceSnapshotHashes: input.evidenceSnapshotHashes,
      policyVersion: input.policyVersion,
      safetyCaseVersion: input.safetyCaseVersion,
      routingPolicyVersion: input.routingPolicyVersion,
      connectorSchemaHashes: [],
      reservationId: input.reservationId,
    }, input.budget, this.clock);
    if (!treeResult.ok) return treeResult;
    const tree = treeResult.value;
    tree.start();
    const leaseId = randomUUID();
    const leased = tree.lease(rootBranchId, {
      id: leaseId,
      tenantId: input.tenantId,
      workerId: 'deterministic-laboratory-worker',
      generation: 0,
      expiresAt: new Date(this.clock.now().getTime() + Math.max(1, input.budget.wallTimeMs)),
    }, this.clock.now());
    if (!leased.ok) return leased;
    const committed = tree.commit(rootBranchId, leaseId, 1, 'verified-input-scenario', {}, this.clock.now());
    if (!committed.ok) return committed;
    const treeCompleted = tree.complete();
    if (!treeCompleted.ok) return treeCompleted;

    const evaluationResult = EvaluationRun.plan(randomUUID(), input.tenantId, {
      scenarioManifestHash: tree.id,
      evidenceManifestHash: input.evidenceSnapshotHashes.join(':'),
      preferenceManifestHash: preference.value.profileId,
      policyManifestHash: input.policyVersion,
    }, input.contract.options.map(({ id }) => id), this.clock);
    if (!evaluationResult.ok) return evaluationResult;
    const evaluation = evaluationResult.value;
    evaluation.start();
    for (const finding of input.findings) {
      const { hardConstraint = false, ...value } = finding;
      const recorded = evaluation.recordFinding(value, hardConstraint);
      if (!recorded.ok) return recorded;
    }
    for (const score of input.scores) {
      const scored = evaluation.score(score);
      if (!scored.ok) return scored;
    }
    const completed = evaluation.complete();
    if (!completed.ok) return completed;

    const abstention = evaluation.abstention;
    const briefResult = DecisionBrief.compose(randomUUID(), input.tenantId, evaluation.id, {
      eligibleOptions: abstention === undefined ? evaluation.eligibleOptions() : [],
      paretoOptions: abstention === undefined ? evaluation.paretoFrontier() : [],
      assumptions: input.assumptions,
      materialClaims: input.findings.map((finding) => ({
        text: finding.rationale,
        evidenceReferences: finding.evidenceReferences,
      })),
      dissent: input.findings.filter(({ status }) => status === 'uncertain').map(({ rationale }) => rationale),
      sensitivitySummary: JSON.stringify(evaluation.sensitivity([
        Object.fromEntries(input.criteria.map(({ key, weight }) => [key, weight])),
      ])),
      limitations: input.limitations,
      callToAction: abstention === undefined
        ? 'An authorized human should review the evidence and record the decision.'
        : 'An authorized human should address the unblock conditions before deciding.',
      ...(abstention === undefined ? {} : { abstention }),
    }, this.clock);
    if (!briefResult.ok) return briefResult;
    const brief = briefResult.value;
    const published = brief.publish();
    if (!published.ok) return published;
    deliberation.attachBrief(brief.id);
    return { ok: true, value: { deliberation, scenarioTree: tree, evaluation, brief } };
  }
}
