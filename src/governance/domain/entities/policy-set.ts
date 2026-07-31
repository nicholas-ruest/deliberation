import { AggregateRoot, type Clock, type Result, invariant } from '../../../shared/domain/index.js';

export type PolicyEffect = 'allow' | 'deny' | 'allow-with-obligations';
export type RiskTier = 'low' | 'moderate' | 'high' | 'prohibited';

export interface PolicyInput {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly roles: readonly string[];
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId?: string;
  readonly purpose: string;
  readonly riskTier: RiskTier;
  readonly capabilities: readonly string[];
  readonly consentPurposes: readonly string[];
}

export interface PolicyRule {
  readonly id: string;
  readonly priority: number;
  readonly effect: PolicyEffect;
  readonly actions: readonly string[];
  readonly roles?: readonly string[];
  readonly purposes?: readonly string[];
  readonly maximumRiskTier?: Exclude<RiskTier, 'prohibited'>;
  readonly obligations?: readonly string[];
  readonly platformMandatory?: boolean;
}

export interface PolicyDecision {
  readonly id: string;
  readonly effect: PolicyEffect;
  readonly policySetId: string;
  readonly policyVersion: number;
  readonly reasonCodes: readonly string[];
  readonly obligations: readonly string[];
}

export type PolicyState = 'draft' | 'approved' | 'active' | 'retired';

const riskOrder: Record<RiskTier, number> = { low: 0, moderate: 1, high: 2, prohibited: 3 };

export class PolicySet extends AggregateRoot {
  readonly rules: PolicyRule[] = [];
  public state: PolicyState = 'draft';
  private approverIds = new Set<string>();

  private constructor(id: string, tenantId: string, now: Date, readonly authorId: string) {
    super(id, tenantId, 0, now, now);
  }

  static draft(id: string, tenantId: string, authorId: string, clock: Clock): PolicySet {
    return new PolicySet(id, tenantId, clock.now(), authorId);
  }

  addRule(rule: PolicyRule): Result<PolicySet> {
    if (this.state !== 'draft') return { ok: false, error: invariant('Only draft policies can change') };
    if (this.rules.some(({ id }) => id === rule.id)) return { ok: false, error: invariant('Policy rule IDs are unique') };
    this.rules.push(rule);
    return { ok: true, value: this };
  }

  approve(approverId: string): Result<PolicySet> {
    if (approverId === this.authorId) return { ok: false, error: invariant('Policy author cannot be sole approver') };
    this.approverIds.add(approverId);
    this.state = 'approved';
    return { ok: true, value: this };
  }

  activate(): Result<PolicySet> {
    if (this.state !== 'approved' || this.approverIds.size === 0) {
      return { ok: false, error: invariant('Validated independent approval is required') };
    }
    this.state = 'active';
    return { ok: true, value: this };
  }

  evaluate(input: PolicyInput, decisionId: string): PolicyDecision {
    if (this.state !== 'active' || input.tenantId !== this.tenantId || input.riskTier === 'prohibited') {
      return this.deny(decisionId, ['POLICY_INACTIVE_OR_SCOPE_DENIED']);
    }
    const matching = this.rules
      .filter((rule) => rule.actions.includes(input.action))
      .filter((rule) => rule.roles === undefined || rule.roles.some((role) => input.roles.includes(role)))
      .filter((rule) => rule.purposes === undefined || rule.purposes.includes(input.purpose))
      .filter((rule) => rule.maximumRiskTier === undefined || riskOrder[input.riskTier] <= riskOrder[rule.maximumRiskTier])
      .sort((a, b) => b.priority - a.priority);
    const denied = matching.filter(({ effect }) => effect === 'deny');
    if (denied.length > 0) return this.deny(decisionId, denied.map(({ id }) => `DENY:${id}`));
    const allows = matching.filter(({ effect }) => effect !== 'deny');
    if (allows.length === 0) return this.deny(decisionId, ['DEFAULT_DENY']);
    const obligations = [...new Set(allows.flatMap(({ obligations }) => obligations ?? []))].sort();
    return {
      id: decisionId,
      effect: obligations.length > 0 ? 'allow-with-obligations' : 'allow',
      policySetId: this.id,
      policyVersion: this.version,
      reasonCodes: allows.map(({ id }) => `ALLOW:${id}`),
      obligations,
    };
  }

  private deny(id: string, reasonCodes: readonly string[]): PolicyDecision {
    return {
      id,
      effect: 'deny',
      policySetId: this.id,
      policyVersion: this.version,
      reasonCodes,
      obligations: [],
    };
  }
}
