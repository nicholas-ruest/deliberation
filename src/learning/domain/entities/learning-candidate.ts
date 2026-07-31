import { AggregateRoot, type Clock, type Result, invariant } from '../../../shared/domain/index.js';

export interface EvaluationMetric {
  readonly name: string;
  readonly candidate: number;
  readonly baseline: number;
  readonly direction: 'higher-is-better' | 'lower-is-better';
  readonly requiredNonRegression: boolean;
}

export type CandidateState = 'draft' | 'evaluated' | 'approved' | 'canary' | 'promoted' | 'rejected' | 'rolled-back';

export interface CanaryPolicy {
  readonly minimumObservations: number;
  readonly maximumFailureRate: number;
}

export class LearningCandidate extends AggregateRoot {
  public state: CandidateState = 'draft';
  private metrics: readonly EvaluationMetric[] = [];
  private readonly approvers = new Set<string>();
  public signedArtifactDigest?: string;
  public priorArtifactDigest?: string;
  private canaryPolicy?: CanaryPolicy;
  private canaryObservations = 0;
  private canaryFailures = 0;

  private constructor(
    id: string,
    tenantId: string,
    now: Date,
    readonly authorId: string,
    readonly candidateType: string,
    readonly derivationManifestHash: string,
  ) {
    super(id, tenantId, 0, now, now);
  }

  static propose(
    id: string,
    tenantId: string,
    authorId: string,
    candidateType: string,
    derivationManifestHash: string,
    clock: Clock,
  ): LearningCandidate {
    return new LearningCandidate(id, tenantId, clock.now(), authorId, candidateType, derivationManifestHash);
  }

  attachEvaluation(metrics: readonly EvaluationMetric[]): Result<LearningCandidate> {
    if (this.state !== 'draft' || metrics.length === 0) return { ok: false, error: invariant('Draft candidate and evaluation metrics required') };
    const regressed = metrics.some((metric) => metric.requiredNonRegression && (
      metric.direction === 'higher-is-better' ? metric.candidate < metric.baseline : metric.candidate > metric.baseline
    ));
    if (regressed) {
      this.state = 'rejected';
      return { ok: false, error: invariant('Safety/privacy/fairness non-regression failed') };
    }
    this.metrics = Object.freeze([...metrics]);
    this.state = 'evaluated';
    return { ok: true, value: this };
  }

  approve(approverId: string, signedArtifactDigest: string, priorArtifactDigest: string): Result<LearningCandidate> {
    if (this.state !== 'evaluated' || approverId === this.authorId || signedArtifactDigest.length === 0 || priorArtifactDigest.length === 0) {
      return { ok: false, error: invariant('Independent approval and signed current/prior artifacts required') };
    }
    this.approvers.add(approverId);
    this.signedArtifactDigest = signedArtifactDigest;
    this.priorArtifactDigest = priorArtifactDigest;
    this.state = 'approved';
    return { ok: true, value: this };
  }

  startCanary(policy: CanaryPolicy): Result<LearningCandidate> {
    if (this.state !== 'approved' || !Number.isSafeInteger(policy.minimumObservations)
      || policy.minimumObservations < 1 || policy.maximumFailureRate < 0 || policy.maximumFailureRate > 1) {
      return { ok: false, error: invariant('Approved candidate and valid canary policy required') };
    }
    this.canaryPolicy = Object.freeze({ ...policy });
    this.state = 'canary';
    return { ok: true, value: this };
  }

  observeCanary(breachedThreshold: boolean): Result<LearningCandidate> {
    if (this.state !== 'canary' || this.canaryPolicy === undefined) return { ok: false, error: invariant('Canary is not active') };
    this.canaryObservations += 1;
    if (breachedThreshold) this.canaryFailures += 1;
    if (this.canaryFailures / this.canaryObservations > this.canaryPolicy.maximumFailureRate) {
      this.state = 'rolled-back';
    } else if (this.canaryObservations >= this.canaryPolicy.minimumObservations) {
      this.state = 'promoted';
    }
    return { ok: true, value: this };
  }

  rollbackTarget(): Result<string> {
    return this.state === 'rolled-back' && this.priorArtifactDigest !== undefined
      ? { ok: true, value: this.priorArtifactDigest }
      : { ok: false, error: invariant('Candidate is not rolled back to a signed prior artifact') };
  }
}
