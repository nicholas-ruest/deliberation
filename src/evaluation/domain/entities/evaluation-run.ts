import { AggregateRoot, type Clock, type Result, invariant } from '../../../shared/domain/index.js';

export type FindingKind = 'deterministic' | 'policy' | 'simulation' | 'human' | 'model-judgment';
export type FindingStatus = 'pass' | 'fail' | 'uncertain';

export interface VerificationFinding {
  readonly id: string;
  readonly optionId: string;
  readonly claimId: string;
  readonly kind: FindingKind;
  readonly status: FindingStatus;
  readonly evidenceReferences: readonly string[];
  readonly verifierVersion: string;
  readonly rationale: string;
}

export interface CriterionScore {
  readonly optionId: string;
  readonly criterionKey: string;
  readonly value: number;
  readonly unit: string;
  readonly normalizedUtility: number;
  readonly weight: number;
  readonly rubricVersion: string;
}

export interface EvaluationInputManifest {
  readonly scenarioManifestHash: string;
  readonly evidenceManifestHash: string;
  readonly preferenceManifestHash: string;
  readonly policyManifestHash: string;
}

export type EvaluationState = 'planned' | 'active' | 'completed' | 'abstained';

export interface Abstention {
  readonly reasons: readonly string[];
  readonly unblockConditions: readonly string[];
}

export class EvaluationRun extends AggregateRoot {
  public state: EvaluationState = 'planned';
  private readonly findings = new Map<string, VerificationFinding>();
  private readonly scores: CriterionScore[] = [];
  private readonly hardFailures = new Map<string, Set<string>>();
  public abstention?: Abstention;

  private constructor(
    id: string,
    tenantId: string,
    now: Date,
    readonly inputManifest: EvaluationInputManifest,
    readonly optionIds: readonly string[],
  ) {
    super(id, tenantId, 0, now, now);
  }

  static plan(
    id: string,
    tenantId: string,
    inputManifest: EvaluationInputManifest,
    optionIds: readonly string[],
    clock: Clock,
  ): Result<EvaluationRun> {
    if (optionIds.length === 0 || new Set(optionIds).size !== optionIds.length) {
      return { ok: false, error: invariant('Unique evaluation options required') };
    }
    return { ok: true, value: new EvaluationRun(id, tenantId, clock.now(), Object.freeze(inputManifest), Object.freeze([...optionIds])) };
  }

  start(): void {
    if (this.state === 'planned') this.state = 'active';
  }

  recordFinding(finding: VerificationFinding, hardConstraint = false): Result<EvaluationRun> {
    if (this.state !== 'active' || !this.optionIds.includes(finding.optionId) || finding.evidenceReferences.length === 0) {
      return { ok: false, error: invariant('Active run, known option, and provenance required') };
    }
    if (finding.kind === 'model-judgment' && finding.status === 'pass') {
      const stronger = [...this.findings.values()].some((candidate) =>
        candidate.claimId === finding.claimId
        && candidate.optionId === finding.optionId
        && candidate.status === 'pass'
        && candidate.kind !== 'model-judgment');
      if (!stronger) return { ok: false, error: invariant('Generic model judgment cannot verify a claim alone') };
    }
    this.findings.set(finding.id, Object.freeze({ ...finding }));
    if (hardConstraint && finding.status === 'fail') {
      const failures = this.hardFailures.get(finding.optionId) ?? new Set<string>();
      failures.add(finding.claimId);
      this.hardFailures.set(finding.optionId, failures);
    }
    return { ok: true, value: this };
  }

  score(score: CriterionScore): Result<EvaluationRun> {
    if (this.state !== 'active' || !this.optionIds.includes(score.optionId)
      || !Number.isFinite(score.value) || !Number.isFinite(score.normalizedUtility)
      || !Number.isFinite(score.weight) || score.normalizedUtility < 0 || score.normalizedUtility > 1
      || score.weight < 0 || score.unit.length === 0 || score.rubricVersion.length === 0) {
      return { ok: false, error: invariant('Valid bounded score required') };
    }
    if (this.scores.some((candidate) =>
      candidate.optionId === score.optionId && candidate.criterionKey === score.criterionKey)) {
      return { ok: false, error: invariant('Option/criterion score must be unique') };
    }
    this.scores.push(Object.freeze({ ...score }));
    return { ok: true, value: this };
  }

  eligibleOptions(): readonly string[] {
    return [...this.optionIds].filter((id) => (this.hardFailures.get(id)?.size ?? 0) === 0).sort();
  }

  utility(optionId: string): number {
    if (!this.eligibleOptions().includes(optionId)) return Number.NEGATIVE_INFINITY;
    return this.scores.filter((score) => score.optionId === optionId)
      .reduce((sum, score) => sum + score.normalizedUtility * score.weight, 0);
  }

  paretoFrontier(): readonly string[] {
    const vectors = new Map(this.eligibleOptions().map((optionId) => [
      optionId,
      new Map(this.scores.filter((score) => score.optionId === optionId).map((score) => [score.criterionKey, score.normalizedUtility])),
    ]));
    return [...vectors.keys()].filter((candidate) =>
      ![...vectors.keys()].some((other) => other !== candidate && dominates(vectors.get(other)!, vectors.get(candidate)!)),
    ).sort();
  }

  sensitivity(weightSets: readonly Readonly<Record<string, number>>[]): Readonly<Record<string, number>> {
    const wins: Record<string, number> = Object.fromEntries(this.eligibleOptions().map((id) => [id, 0]));
    for (const weights of weightSets) {
      const ordered = this.eligibleOptions().map((optionId) => ({
        optionId,
        score: this.scores.filter((score) => score.optionId === optionId)
          .reduce((sum, score) => sum + score.normalizedUtility * (weights[score.criterionKey] ?? 0), 0),
      })).sort((a, b) => b.score - a.score || a.optionId.localeCompare(b.optionId));
      const winner = ordered[0];
      if (winner !== undefined) wins[winner.optionId] = (wins[winner.optionId] ?? 0) + 1;
    }
    return Object.freeze(wins);
  }

  abstain(reasons: readonly string[], unblockConditions: readonly string[]): Result<EvaluationRun> {
    if (this.state !== 'active' || reasons.length === 0) return { ok: false, error: invariant('Active run and abstention reason required') };
    this.abstention = Object.freeze({ reasons: [...reasons], unblockConditions: [...unblockConditions] });
    this.state = 'abstained';
    return { ok: true, value: this };
  }

  complete(): Result<EvaluationRun> {
    if (this.state !== 'active') return { ok: false, error: invariant('Only active evaluation completes') };
    if (this.eligibleOptions().length === 0) return this.abstain(['ALL_OPTIONS_FAIL_HARD_CONSTRAINTS'], ['Revise options or constraints']);
    for (const optionId of this.eligibleOptions()) {
      const optionScores = this.scores.filter((score) => score.optionId === optionId);
      const weight = optionScores.reduce((sum, score) => sum + score.weight, 0);
      if (optionScores.length === 0 || Math.abs(weight - 1) > 1e-9) {
        return this.abstain(['INCOMPLETE_OR_UNNORMALIZED_SCORECARD'], ['Complete a normalized scorecard for every eligible option']);
      }
    }
    this.state = 'completed';
    return { ok: true, value: this };
  }
}

function dominates(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  const keys = new Set([...a.keys(), ...b.keys()]);
  let strictlyBetter = false;
  for (const key of keys) {
    const left = a.get(key) ?? 0;
    const right = b.get(key) ?? 0;
    if (left < right) return false;
    if (left > right) strictlyBetter = true;
  }
  return strictlyBetter;
}
