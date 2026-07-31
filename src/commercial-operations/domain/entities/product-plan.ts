import { AggregateRoot, type Clock, type Result, invariant } from '../../../shared/domain/index.js';

export class ProductPlan extends AggregateRoot {
  public state: 'draft' | 'published' | 'retired' = 'draft';

  private constructor(
    id: string,
    tenantId: string,
    now: Date,
    readonly featureCodes: ReadonlySet<string>,
    readonly effectiveAt: Date,
  ) {
    super(id, tenantId, 0, now, now);
  }

  static draft(id: string, featureCodes: readonly string[], effectiveAt: Date, clock: Clock): Result<ProductPlan> {
    if (new Set(featureCodes).size !== featureCodes.length) return { ok: false, error: invariant('Feature codes must be unique') };
    return { ok: true, value: new ProductPlan(id, id, clock.now(), new Set(featureCodes), effectiveAt) };
  }

  publish(now: Date): Result<ProductPlan> {
    if (this.state !== 'draft' || this.featureCodes.size === 0 || this.effectiveAt < now) {
      return { ok: false, error: invariant('Valid future-effective plan required') };
    }
    this.state = 'published';
    return { ok: true, value: this };
  }
}

export class CustomerContract extends AggregateRoot {
  public state: 'proposed' | 'active' | 'terminated' = 'proposed';

  constructor(
    id: string,
    tenantId: string,
    now: Date,
    readonly planId: string,
    readonly startsAt: Date,
    readonly endsAt: Date,
    readonly approvedOverrides: Readonly<Record<string, unknown>>,
  ) {
    super(id, tenantId, 0, now, now);
  }

  activate(now: Date): Result<CustomerContract> {
    if (this.state !== 'proposed' || this.startsAt >= this.endsAt || now > this.endsAt) {
      return { ok: false, error: invariant('Valid contract term required') };
    }
    this.state = 'active';
    return { ok: true, value: this };
  }

  terminate(): void {
    this.state = 'terminated';
  }
}
