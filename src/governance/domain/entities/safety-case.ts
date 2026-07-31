import { AggregateRoot, type Clock, type Result, invariant } from '../../../shared/domain/index.js';
import type { RiskTier } from './policy-set.js';

export type SafetyCaseState = 'draft' | 'validated' | 'approved' | 'active' | 'suspended' | 'expired' | 'retired';

export interface SafetyControl {
  readonly hazard: string;
  readonly mitigation: string;
  readonly evidenceReference: string;
}

export class SafetyCase extends AggregateRoot {
  public state: SafetyCaseState = 'draft';
  readonly controls: SafetyControl[] = [];
  private approverIds = new Set<string>();

  private constructor(
    id: string,
    tenantId: string,
    now: Date,
    readonly authorId: string,
    readonly useCase: string,
    readonly riskTier: RiskTier,
    readonly prohibitedUses: readonly string[],
    readonly expiresAt: Date,
  ) {
    super(id, tenantId, 0, now, now);
  }

  static draft(
    id: string,
    tenantId: string,
    authorId: string,
    useCase: string,
    riskTier: RiskTier,
    prohibitedUses: readonly string[],
    expiresAt: Date,
    clock: Clock,
  ): SafetyCase {
    return new SafetyCase(id, tenantId, clock.now(), authorId, useCase, riskTier, prohibitedUses, expiresAt);
  }

  addControl(control: SafetyControl): Result<SafetyCase> {
    if (this.state !== 'draft') return { ok: false, error: invariant('Controls can only change in draft') };
    this.controls.push(control);
    return { ok: true, value: this };
  }

  validate(): Result<SafetyCase> {
    if (this.riskTier === 'prohibited' || this.controls.length === 0) {
      return { ok: false, error: invariant('Prohibited or uncontrolled use cannot validate') };
    }
    this.state = 'validated';
    return { ok: true, value: this };
  }

  approve(approverId: string): Result<SafetyCase> {
    if (this.state !== 'validated' || approverId === this.authorId) {
      return { ok: false, error: invariant('Independent approval of a validated safety case is required') };
    }
    this.approverIds.add(approverId);
    this.state = 'approved';
    return { ok: true, value: this };
  }

  activate(now: Date): Result<SafetyCase> {
    if (this.state !== 'approved' || this.approverIds.size === 0 || now >= this.expiresAt) {
      return { ok: false, error: invariant('Current independent approval is required') };
    }
    this.state = 'active';
    return { ok: true, value: this };
  }

  suspend(): void {
    if (this.state === 'active') this.state = 'suspended';
  }
}
