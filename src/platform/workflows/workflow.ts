import type { DomainError, Result } from '../../shared/domain/result.js';

export type WorkflowStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'dead-lettered';

export interface RetryPolicy {
  readonly maximumAttempts: number;
  readonly initialDelayMs: number;
  readonly maximumDelayMs: number;
  readonly jitterRatio: number;
}

export interface WorkflowStep<C> {
  readonly name: string;
  execute(context: C, generation: number): Promise<Result<void>>;
  compensate?(context: C, generation: number): Promise<Result<void>>;
}

export interface WorkflowSnapshot<C> {
  readonly id: string;
  readonly tenantId: string;
  readonly version: number;
  readonly status: WorkflowStatus;
  readonly nextStep: number;
  readonly generation: number;
  readonly attempts: Readonly<Record<string, number>>;
  readonly context: C;
  readonly error?: DomainError;
  readonly repairReason?: string;
}

export interface WorkflowStore<C> {
  load(id: string): Promise<WorkflowSnapshot<C> | undefined>;
  save(snapshot: WorkflowSnapshot<C>, expectedVersion: number): Promise<Result<WorkflowSnapshot<C>>>;
}

export class InMemoryWorkflowStore<C> implements WorkflowStore<C> {
  private readonly values = new Map<string, WorkflowSnapshot<C>>();

  async load(id: string): Promise<WorkflowSnapshot<C> | undefined> {
    return this.values.get(id);
  }

  async save(snapshot: WorkflowSnapshot<C>, expectedVersion: number): Promise<Result<WorkflowSnapshot<C>>> {
    const actual = this.values.get(snapshot.id)?.version ?? 0;
    if (actual !== expectedVersion) {
      return { ok: false, error: { code: 'VERSION_CONFLICT', message: 'Workflow version conflict' } };
    }
    const saved = Object.freeze({ ...snapshot, version: expectedVersion + 1 });
    this.values.set(snapshot.id, saved);
    return { ok: true, value: saved };
  }
}

export class DurableWorkflow<C> {
  constructor(
    private readonly store: WorkflowStore<C>,
    private readonly steps: readonly WorkflowStep<C>[],
    private readonly retryPolicy: RetryPolicy,
  ) {}

  async start(id: string, tenantId: string, context: C): Promise<Result<WorkflowSnapshot<C>>> {
    if (await this.store.load(id) !== undefined) {
      return { ok: false, error: { code: 'IDEMPOTENCY_CONFLICT', message: 'Workflow already exists' } };
    }
    return this.store.save({
      id,
      tenantId,
      version: 0,
      status: 'running',
      nextStep: 0,
      generation: 1,
      attempts: {},
      context,
    }, 0);
  }

  async tick(id: string): Promise<Result<WorkflowSnapshot<C>>> {
    const snapshot = await this.store.load(id);
    if (snapshot === undefined) return { ok: false, error: { code: 'NOT_FOUND', message: 'Workflow not found' } };
    if (snapshot.status !== 'running') return { ok: true, value: snapshot };
    const step = this.steps[snapshot.nextStep];
    if (step === undefined) return this.persist(snapshot, { status: 'succeeded' });
    const attempt = (snapshot.attempts[step.name] ?? 0) + 1;
    const executed = await step.execute(snapshot.context, snapshot.generation);
    if (executed.ok) {
      return this.persist(snapshot, {
        nextStep: snapshot.nextStep + 1,
        attempts: { ...snapshot.attempts, [step.name]: attempt },
      });
    }
    if (executed.error.retryable && attempt < this.retryPolicy.maximumAttempts) {
      return this.persist(snapshot, { attempts: { ...snapshot.attempts, [step.name]: attempt }, error: executed.error });
    }
    await this.compensate(snapshot);
    return this.persist(snapshot, {
      status: executed.error.retryable ? 'dead-lettered' : 'failed',
      attempts: { ...snapshot.attempts, [step.name]: attempt },
      error: executed.error,
    });
  }

  async cancel(id: string): Promise<Result<WorkflowSnapshot<C>>> {
    const snapshot = await this.store.load(id);
    if (snapshot === undefined) return { ok: false, error: { code: 'NOT_FOUND', message: 'Workflow not found' } };
    if (snapshot.status !== 'running') return { ok: true, value: snapshot };
    await this.compensate(snapshot);
    return this.persist(snapshot, { status: 'cancelled', generation: snapshot.generation + 1 });
  }

  async repair(id: string, expectedVersion: number, reason: string): Promise<Result<WorkflowSnapshot<C>>> {
    const snapshot = await this.store.load(id);
    if (snapshot === undefined) return { ok: false, error: { code: 'NOT_FOUND', message: 'Workflow not found' } };
    if (snapshot.version !== expectedVersion || snapshot.status !== 'dead-lettered') {
      return { ok: false, error: { code: 'VERSION_CONFLICT', message: 'Workflow is not repairable at this version' } };
    }
    return this.persist(snapshot, {
      status: 'running',
      generation: snapshot.generation + 1,
      repairReason: reason,
    }, true);
  }

  private async compensate(snapshot: WorkflowSnapshot<C>): Promise<void> {
    for (const step of [...this.steps.slice(0, snapshot.nextStep)].reverse()) {
      if (step.compensate !== undefined) await step.compensate(snapshot.context, snapshot.generation);
    }
  }

  private persist(
    snapshot: WorkflowSnapshot<C>,
    patch: Partial<WorkflowSnapshot<C>>,
    clearError = false,
  ): Promise<Result<WorkflowSnapshot<C>>> {
    const updated = { ...snapshot, ...patch } as WorkflowSnapshot<C>;
    if (clearError) delete (updated as { error?: DomainError }).error;
    return this.store.save(updated, snapshot.version);
  }
}
