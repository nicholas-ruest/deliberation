import type { Result } from '../../../shared/domain/result.js';

export interface BranchMemoryScope {
  readonly tenantId: string;
  readonly purpose: string;
  readonly treeId: string;
  readonly branchId: string;
  readonly frozenInputHash: string;
}

export interface MemoryDelta {
  readonly key: string;
  readonly value?: Uint8Array;
  readonly tombstone: boolean;
  readonly provenanceReference: string;
}

export interface BranchMemoryPort {
  create(scope: BranchMemoryScope, parentBranchId?: string): Promise<Result<void>>;
  read(scope: BranchMemoryScope, key: string): Promise<Result<Uint8Array | undefined>>;
  write(scope: BranchMemoryScope, delta: MemoryDelta): Promise<Result<void>>;
  diff(scope: BranchMemoryScope): Promise<Result<readonly MemoryDelta[]>>;
  discard(scope: BranchMemoryScope): Promise<Result<void>>;
  promote(scope: BranchMemoryScope, deltas: readonly MemoryDelta[], verificationReference: string): Promise<Result<void>>;
}
