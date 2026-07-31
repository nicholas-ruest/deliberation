import { AggregateRoot, type Clock, type Result, invariant } from '../../../shared/domain/index.js';

export type DeliberationState =
  | 'draft' | 'scoped' | 'ready' | 'running' | 'review' | 'decided' | 'closed' | 'cancelled';

export interface DecisionOption {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
}

export interface DecisionContract {
  readonly question: string;
  readonly successDefinition: string;
  readonly options: readonly DecisionOption[];
  readonly generateOptions: boolean;
  readonly constraints: readonly string[];
  readonly stakeholderIds: readonly string[];
  readonly decisionAuthorityId: string;
  readonly riskClassificationReference: string;
  readonly deadline: Date;
}

export interface RecordedDecision {
  readonly optionId: string;
  readonly authorityId: string;
  readonly rationale: string;
  readonly recordedAt: Date;
}

export class DeliberationCase extends AggregateRoot {
  public state: DeliberationState = 'draft';
  public contract?: DecisionContract;
  public revision = 1;
  public activePlanningRunId: string | undefined = undefined;
  public readonly briefReferences: string[] = [];
  public recordedDecision?: RecordedDecision;

  private constructor(id: string, tenantId: string, now: Date, readonly title: string) {
    super(id, tenantId, 0, now, now);
  }

  static draft(id: string, tenantId: string, title: string, clock: Clock): Result<DeliberationCase> {
    if (title.trim().length === 0) return { ok: false, error: invariant('Title is required') };
    return { ok: true, value: new DeliberationCase(id, tenantId, clock.now(), title.trim()) };
  }

  defineContract(contract: DecisionContract): Result<DeliberationCase> {
    if (this.state !== 'draft') return { ok: false, error: invariant('Only draft cases can change scope') };
    if (contract.question.trim().length === 0 || contract.successDefinition.trim().length === 0) {
      return { ok: false, error: invariant('Decision question and success definition are required') };
    }
    if (!contract.generateOptions && contract.options.length < 2) {
      return { ok: false, error: invariant('At least two options or a generate-options mandate is required') };
    }
    if (new Set(contract.options.map(({ id }) => id)).size !== contract.options.length) {
      return { ok: false, error: invariant('Option IDs must be unique') };
    }
    this.contract = Object.freeze({ ...contract, options: [...contract.options], constraints: [...contract.constraints] });
    return { ok: true, value: this };
  }

  scope(): Result<DeliberationCase> {
    if (this.state !== 'draft' || this.contract === undefined) {
      return { ok: false, error: invariant('A valid decision contract is required') };
    }
    this.state = 'scoped';
    return { ok: true, value: this };
  }

  markReady(now: Date): Result<DeliberationCase> {
    if (this.state !== 'scoped' || this.contract === undefined || this.contract.deadline <= now) {
      return { ok: false, error: invariant('Scoped non-expired case required') };
    }
    this.state = 'ready';
    return { ok: true, value: this };
  }

  requestPlanning(runId: string): Result<DeliberationCase> {
    if (this.state !== 'ready' || this.activePlanningRunId !== undefined) {
      return { ok: false, error: invariant('One active planning run per ready revision') };
    }
    this.activePlanningRunId = runId;
    this.state = 'running';
    return { ok: true, value: this };
  }

  attachBrief(briefId: string): Result<DeliberationCase> {
    if (!['running', 'review'].includes(this.state)) return { ok: false, error: invariant('Case is not accepting briefs') };
    if (!this.briefReferences.includes(briefId)) this.briefReferences.push(briefId);
    this.activePlanningRunId = undefined;
    this.state = 'review';
    return { ok: true, value: this };
  }

  recordHumanDecision(decision: RecordedDecision, clock: Clock): Result<DeliberationCase> {
    if (this.recordedDecision !== undefined) {
      const identical = this.recordedDecision.optionId === decision.optionId
        && this.recordedDecision.authorityId === decision.authorityId
        && this.recordedDecision.rationale === decision.rationale;
      return identical
        ? { ok: true, value: this }
        : { ok: false, error: { code: 'IDEMPOTENCY_CONFLICT', message: 'A conflicting decision is already recorded' } };
    }
    if (this.state !== 'review' || this.contract === undefined) return { ok: false, error: invariant('Case is not in review') };
    if (decision.authorityId !== this.contract.decisionAuthorityId) {
      return { ok: false, error: { code: 'PERMISSION_DENIED', message: 'Only the named human authority may record the decision' } };
    }
    if (!this.contract.options.some(({ id }) => id === decision.optionId)) {
      return { ok: false, error: invariant('Decision must reference a contract option') };
    }
    this.recordedDecision = { ...decision, recordedAt: clock.now() };
    this.state = 'decided';
    return { ok: true, value: this };
  }

  close(): Result<DeliberationCase> {
    if (this.state !== 'decided') return { ok: false, error: invariant('Only decided cases can close') };
    this.state = 'closed';
    return { ok: true, value: this };
  }

  cancel(): Result<DeliberationCase> {
    if (['decided', 'closed', 'cancelled'].includes(this.state)) {
      return { ok: false, error: invariant('Terminal/decided case cannot be cancelled') };
    }
    this.state = 'cancelled';
    this.activePlanningRunId = undefined;
    return { ok: true, value: this };
  }
}
