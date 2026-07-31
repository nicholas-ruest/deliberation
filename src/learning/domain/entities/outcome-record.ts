import { AggregateRoot, type Clock, type Result, invariant } from '../../../shared/domain/index.js';

export interface Prediction {
  readonly id: string;
  readonly optionId: string;
  readonly measure: string;
  readonly predictedValue: number;
  readonly unit: string;
  readonly madeAt: Date;
  readonly calibrationBasis?: string;
}

export interface Observation {
  readonly id: string;
  readonly measure: string;
  readonly value: number;
  readonly unit: string;
  readonly observedAt: Date;
  readonly capturedAt: Date;
  readonly provenanceReference: string;
  readonly reporterId?: string;
  readonly epistemicClass: 'observed-fact' | 'user-assertion';
  readonly supersedesId?: string;
}

export class OutcomeRecord extends AggregateRoot {
  private readonly predictions = new Map<string, Prediction>();
  private readonly observations = new Map<string, Observation>();
  public learningEligible = false;
  public finalized = false;

  private constructor(id: string, tenantId: string, now: Date, readonly deliberationId: string) {
    super(id, tenantId, 0, now, now);
  }

  static open(id: string, tenantId: string, deliberationId: string, clock: Clock): OutcomeRecord {
    return new OutcomeRecord(id, tenantId, clock.now(), deliberationId);
  }

  addPrediction(prediction: Prediction, decisionRecordedAt?: Date): Result<OutcomeRecord> {
    if (decisionRecordedAt !== undefined && prediction.madeAt >= decisionRecordedAt) {
      return { ok: false, error: invariant('Prediction must precede the recorded decision') };
    }
    if (this.predictions.has(prediction.id)) return { ok: false, error: invariant('Prediction ID must be unique') };
    this.predictions.set(prediction.id, Object.freeze({ ...prediction }));
    return { ok: true, value: this };
  }

  observe(observation: Observation, consentAndPolicyQualified: boolean): Result<OutcomeRecord> {
    if (this.finalized || this.observations.has(observation.id) || observation.provenanceReference.length === 0) {
      return { ok: false, error: invariant('New provenance-bearing observation required') };
    }
    if (observation.supersedesId !== undefined && !this.observations.has(observation.supersedesId)) {
      return { ok: false, error: invariant('Correction must supersede an existing observation') };
    }
    this.observations.set(observation.id, Object.freeze({ ...observation }));
    this.learningEligible = consentAndPolicyQualified;
    return { ok: true, value: this };
  }

  excludeFromLearning(): void {
    this.learningEligible = false;
  }

  finalize(): Result<OutcomeRecord> {
    if (this.observations.size === 0) return { ok: false, error: invariant('At least one observation required') };
    this.finalized = true;
    return { ok: true, value: this };
  }

  cohortObservations(): readonly Observation[] {
    if (!this.learningEligible) return [];
    const superseded = new Set([...this.observations.values()].flatMap(({ supersedesId }) => supersedesId === undefined ? [] : [supersedesId]));
    return [...this.observations.values()].filter(({ id }) => !superseded.has(id));
  }
}
