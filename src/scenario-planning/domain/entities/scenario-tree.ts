import { AggregateRoot, type Clock, type Result, invariant } from '../../../shared/domain/index.js';

export interface PlanningBudget {
  readonly branches: number;
  readonly depth: number;
  readonly tokens: number;
  readonly moneyMinorUnits: number;
  readonly wallTimeMs: number;
  readonly toolCalls: number;
  readonly concurrency: number;
}

export interface FrozenRunManifest {
  readonly deliberationRevisionHash: string;
  readonly preferenceSnapshotHashes: readonly string[];
  readonly evidenceSnapshotHashes: readonly string[];
  readonly policyVersion: string;
  readonly safetyCaseVersion: string;
  readonly routingPolicyVersion: string;
  readonly connectorSchemaHashes: readonly string[];
  readonly reservationId: string;
}

export type BranchState = 'pending' | 'leased' | 'completed' | 'pruned' | 'failed';

export interface ScenarioBranch {
  readonly id: string;
  readonly parentId?: string;
  readonly depth: number;
  readonly assumptions: readonly string[];
  readonly modelCorrelationGroup: string;
  state: BranchState;
  lease?: WorkerLease;
  outputManifestHash?: string;
}

export interface WorkerLease {
  readonly id: string;
  readonly tenantId: string;
  readonly workerId: string;
  readonly generation: number;
  readonly expiresAt: Date;
}

export type ScenarioTreeState = 'planned' | 'active' | 'evaluating' | 'completed' | 'cancelled' | 'failed' | 'budget-exhausted';

export class ScenarioTree extends AggregateRoot {
  public state: ScenarioTreeState = 'planned';
  private readonly branches = new Map<string, ScenarioBranch>();
  private remaining: PlanningBudget;
  private generation = 1;

  private constructor(
    id: string,
    tenantId: string,
    now: Date,
    readonly manifest: FrozenRunManifest,
    readonly budget: PlanningBudget,
    root: ScenarioBranch,
  ) {
    super(id, tenantId, 0, now, now);
    this.remaining = { ...budget, branches: budget.branches - 1 };
    this.branches.set(root.id, root);
  }

  static plan(
    id: string,
    tenantId: string,
    rootId: string,
    manifest: FrozenRunManifest,
    budget: PlanningBudget,
    clock: Clock,
  ): Result<ScenarioTree> {
    if (Object.values(budget).some((value) => !Number.isSafeInteger(value) || value < 0)
      || budget.branches < 1 || budget.concurrency < 1) {
      return { ok: false, error: invariant('All budgets must be safe non-negative integers with one root and positive concurrency') };
    }
    const root: ScenarioBranch = { id: rootId, depth: 0, assumptions: [], modelCorrelationGroup: 'root', state: 'pending' };
    return { ok: true, value: new ScenarioTree(id, tenantId, clock.now(), Object.freeze(manifest), Object.freeze({ ...budget }), root) };
  }

  start(): Result<ScenarioTree> {
    if (this.state !== 'planned') return { ok: false, error: invariant('Only planned trees start') };
    this.state = 'active';
    return { ok: true, value: this };
  }

  allocateBranch(input: {
    id: string;
    parentId: string;
    assumptions: readonly string[];
    modelCorrelationGroup: string;
  }): Result<ScenarioBranch> {
    if (this.state !== 'active') return { ok: false, error: invariant('Tree is not active') };
    const parent = this.branches.get(input.parentId);
    if (parent === undefined || parent.state === 'pruned') return { ok: false, error: invariant('Valid non-pruned parent required') };
    if (this.branches.has(input.id) || parent.depth + 1 > this.budget.depth || this.remaining.branches < 1) {
      if (this.remaining.branches < 1) this.state = 'budget-exhausted';
      return { ok: false, error: { code: 'QUOTA_EXHAUSTED', message: 'Branch/depth budget exhausted' } };
    }
    const branch: ScenarioBranch = {
      id: input.id,
      parentId: parent.id,
      depth: parent.depth + 1,
      assumptions: Object.freeze([...input.assumptions]),
      modelCorrelationGroup: input.modelCorrelationGroup,
      state: 'pending',
    };
    this.branches.set(branch.id, branch);
    this.remaining = { ...this.remaining, branches: this.remaining.branches - 1 };
    return { ok: true, value: branch };
  }

  lease(branchId: string, lease: WorkerLease, now: Date): Result<ScenarioBranch> {
    const branch = this.branches.get(branchId);
    const activeLeases = [...this.branches.values()].filter(({ state, lease: current }) => state === 'leased' && current !== undefined && current.expiresAt > now).length;
    if (this.state !== 'active' || branch?.state !== 'pending' || lease.tenantId !== this.tenantId || activeLeases >= this.budget.concurrency) {
      return { ok: false, error: { code: 'CAPACITY_UNAVAILABLE', message: 'Branch cannot be leased' } };
    }
    branch.state = 'leased';
    branch.lease = Object.freeze({ ...lease, generation: this.generation });
    return { ok: true, value: branch };
  }

  commit(branchId: string, leaseId: string, generation: number, outputManifestHash: string, usage: Partial<PlanningBudget>, now: Date): Result<ScenarioBranch> {
    const branch = this.branches.get(branchId);
    if (branch?.state === 'completed' && branch.outputManifestHash === outputManifestHash) return { ok: true, value: branch };
    if (this.state !== 'active' || branch?.state !== 'leased' || branch.lease?.id !== leaseId
      || branch.lease.generation !== generation || branch.lease.expiresAt <= now || branch.lease.tenantId !== this.tenantId) {
      return { ok: false, error: { code: 'VERSION_CONFLICT', message: 'Stale, expired, or cross-tenant lease' } };
    }
    const usageEntries = Object.entries(usage) as [keyof PlanningBudget, number][];
    const invalid = usageEntries.find(([dimension, quantity]) =>
      !Number.isSafeInteger(quantity) || quantity < 0 || quantity > this.remaining[dimension]);
    if (invalid !== undefined) {
      this.state = 'budget-exhausted';
      this.generation += 1;
      return { ok: false, error: { code: 'QUOTA_EXHAUSTED', message: `${invalid[0]} budget exhausted` } };
    }
    for (const [dimension, quantity] of usageEntries) {
      this.remaining = { ...this.remaining, [dimension]: this.remaining[dimension] - quantity };
    }
    branch.state = 'completed';
    branch.outputManifestHash = outputManifestHash;
    delete branch.lease;
    return { ok: true, value: branch };
  }

  cancel(): void {
    if (!['completed', 'cancelled', 'failed', 'budget-exhausted'].includes(this.state)) {
      this.state = 'cancelled';
      this.generation += 1;
    }
  }

  complete(): Result<ScenarioTree> {
    if (this.state !== 'active' || [...this.branches.values()].some(({ state }) => !['completed', 'pruned'].includes(state))) {
      return { ok: false, error: invariant('Every branch must be completed or pruned') };
    }
    this.state = 'completed';
    return { ok: true, value: this };
  }

  lineage(branchId: string): readonly string[] {
    const lineage: string[] = [];
    let branch = this.branches.get(branchId);
    const visited = new Set<string>();
    while (branch !== undefined) {
      if (visited.has(branch.id)) throw new Error('Corrupt cyclic lineage');
      visited.add(branch.id);
      lineage.unshift(branch.id);
      branch = branch.parentId === undefined ? undefined : this.branches.get(branch.parentId);
    }
    return lineage;
  }
}
