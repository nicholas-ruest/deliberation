import { AggregateRoot, type Clock, type Result, invariant } from '../../../shared/domain/index.js';

export type ConsentState = 'active' | 'withdrawn';

export class ConsentRecord extends AggregateRoot {
  public state: ConsentState = 'active';
  public withdrawnAt?: Date;
  readonly legalHoldReferences = new Set<string>();

  private constructor(
    id: string,
    tenantId: string,
    now: Date,
    readonly subjectId: string,
    readonly purposes: ReadonlySet<string>,
    readonly dataClasses: ReadonlySet<string>,
    readonly affirmativeEvidenceReference: string,
  ) {
    super(id, tenantId, 0, now, now);
  }

  static grant(
    id: string,
    tenantId: string,
    subjectId: string,
    purposes: readonly string[],
    dataClasses: readonly string[],
    evidenceReference: string,
    clock: Clock,
  ): Result<ConsentRecord> {
    if (purposes.length === 0 || dataClasses.length === 0 || evidenceReference.length === 0) {
      return { ok: false, error: invariant('Granular purpose, data class, and affirmative evidence are required') };
    }
    return {
      ok: true,
      value: new ConsentRecord(id, tenantId, clock.now(), subjectId, new Set(purposes), new Set(dataClasses), evidenceReference),
    };
  }

  withdraw(clock: Clock): Result<ConsentRecord> {
    if (this.state === 'withdrawn') return { ok: true, value: this };
    this.state = 'withdrawn';
    this.withdrawnAt = clock.now();
    this.updatedAt = clock.now();
    return { ok: true, value: this };
  }

  applyLegalHold(reference: string): void {
    this.legalHoldReferences.add(reference);
  }

  permits(purpose: string, dataClass: string): boolean {
    return this.state === 'active' && this.purposes.has(purpose) && this.dataClasses.has(dataClass);
  }
}
