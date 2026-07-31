import { AggregateRoot, type Clock, type Result, invariant } from '../../../shared/domain/index.js';

export type CriterionState = 'suggested' | 'confirmed' | 'retired';

export interface Criterion {
  readonly key: string;
  readonly label: string;
  readonly unit: string;
  readonly weight: number;
  readonly state: CriterionState;
  readonly inferenceProvenance?: string;
}

export interface Veto {
  readonly key: string;
  readonly predicate: string;
  readonly rationale: string;
}

export interface PreferenceSnapshot {
  readonly profileId: string;
  readonly profileVersion: number;
  readonly criteria: readonly Criterion[];
  readonly vetoes: readonly Veto[];
  readonly publishedAt: Date;
}

export class PreferenceProfile extends AggregateRoot {
  private readonly criteria = new Map<string, Criterion>();
  private readonly vetoes = new Map<string, Veto>();

  private constructor(id: string, tenantId: string, now: Date, readonly stakeholderId: string) {
    super(id, tenantId, 0, now, now);
  }

  static create(id: string, tenantId: string, stakeholderId: string, clock: Clock): PreferenceProfile {
    return new PreferenceProfile(id, tenantId, clock.now(), stakeholderId);
  }

  addCriterion(criterion: Criterion): Result<PreferenceProfile> {
    if (this.criteria.has(criterion.key) || !Number.isFinite(criterion.weight) || criterion.weight < 0) {
      return { ok: false, error: invariant('Criterion key must be unique and weight finite/non-negative') };
    }
    this.criteria.set(criterion.key, Object.freeze({ ...criterion }));
    return { ok: true, value: this };
  }

  confirmCriterion(key: string): Result<PreferenceProfile> {
    const criterion = this.criteria.get(key);
    if (criterion === undefined) return { ok: false, error: invariant('Criterion does not exist') };
    this.criteria.set(key, Object.freeze({ ...criterion, state: 'confirmed' }));
    return { ok: true, value: this };
  }

  setWeight(key: string, weight: number): Result<PreferenceProfile> {
    const criterion = this.criteria.get(key);
    if (criterion === undefined || criterion.state !== 'confirmed' || !Number.isFinite(weight) || weight < 0) {
      return { ok: false, error: invariant('Confirmed criterion and finite non-negative weight required') };
    }
    this.criteria.set(key, Object.freeze({ ...criterion, weight }));
    return { ok: true, value: this };
  }

  addVeto(veto: Veto): Result<PreferenceProfile> {
    if (this.vetoes.has(veto.key)) return { ok: false, error: invariant('Veto key must be unique') };
    this.vetoes.set(veto.key, Object.freeze({ ...veto }));
    return { ok: true, value: this };
  }

  publish(clock: Clock): Result<PreferenceSnapshot> {
    const active = [...this.criteria.values()].filter(({ state }) => state === 'confirmed');
    const total = active.reduce((sum, { weight }) => sum + weight, 0);
    if (active.length === 0 || total <= 0) return { ok: false, error: invariant('At least one weighted confirmed criterion is required') };
    const normalized = active.map((criterion) => Object.freeze({ ...criterion, weight: criterion.weight / total }));
    return {
      ok: true,
      value: Object.freeze({
        profileId: this.id,
        profileVersion: this.version,
        criteria: Object.freeze(normalized),
        vetoes: Object.freeze([...this.vetoes.values()]),
        publishedAt: clock.now(),
      }),
    };
  }
}

export function analyzePreferenceConflict(snapshots: readonly PreferenceSnapshot[]): readonly string[] {
  const vetoByKey = new Map<string, Set<string>>();
  for (const snapshot of snapshots) {
    for (const veto of snapshot.vetoes) {
      const predicates = vetoByKey.get(veto.key) ?? new Set<string>();
      predicates.add(veto.predicate);
      vetoByKey.set(veto.key, predicates);
    }
  }
  return [...vetoByKey].filter(([, predicates]) => predicates.size > 1).map(([key]) => key);
}
