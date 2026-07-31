import { createHash } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { AgenticMemory } from 'agenticow';
import type { BranchMemoryPort, BranchMemoryScope, MemoryDelta } from '../domain/repositories/branch-memory.js';
import type { Result } from '../../shared/domain/result.js';

interface BranchData {
  readonly scope: BranchMemoryScope;
  readonly parentBranchId?: string;
  readonly deltas: Map<string, MemoryDelta>;
}

export class DeltaBranchMemory implements BranchMemoryPort {
  private readonly branches = new Map<string, BranchData>();

  async create(scope: BranchMemoryScope, parentBranchId?: string): Promise<Result<void>> {
    const key = this.branchKey(scope);
    const existing = this.branches.get(key);
    if (existing !== undefined) return this.sameScope(existing.scope, scope)
      ? { ok: true, value: undefined }
      : { ok: false, error: { code: 'IDEMPOTENCY_CONFLICT', message: 'Branch scope conflict' } };
    this.branches.set(key, {
      scope: Object.freeze({ ...scope }),
      ...(parentBranchId === undefined ? {} : { parentBranchId }),
      deltas: new Map(),
    });
    return { ok: true, value: undefined };
  }

  async read(scope: BranchMemoryScope, key: string): Promise<Result<Uint8Array | undefined>> {
    let current = this.branches.get(this.branchKey(scope));
    if (current === undefined) return { ok: false, error: { code: 'NOT_FOUND', message: 'Branch not found' } };
    const visited = new Set<string>();
    while (current !== undefined) {
      if (!this.sameBoundary(current.scope, scope)) return { ok: false, error: { code: 'PERMISSION_DENIED', message: 'Branch boundary mismatch' } };
      if (visited.has(current.scope.branchId)) return { ok: false, error: { code: 'INVARIANT_VIOLATION', message: 'Cyclic branch memory' } };
      visited.add(current.scope.branchId);
      const delta = current.deltas.get(key);
      if (delta !== undefined) return { ok: true, value: delta.tombstone ? undefined : delta.value };
      current = current.parentBranchId === undefined
        ? undefined
        : this.branches.get(this.branchKey({ ...scope, branchId: current.parentBranchId }));
    }
    return { ok: true, value: undefined };
  }

  async write(scope: BranchMemoryScope, delta: MemoryDelta): Promise<Result<void>> {
    const branch = this.branches.get(this.branchKey(scope));
    if (branch === undefined || !this.sameScope(branch.scope, scope)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Branch not found' } };
    if (!delta.tombstone && delta.value === undefined) return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'Value or tombstone required' } };
    branch.deltas.set(delta.key, Object.freeze({ ...delta }));
    return { ok: true, value: undefined };
  }

  async diff(scope: BranchMemoryScope): Promise<Result<readonly MemoryDelta[]>> {
    const branch = this.branches.get(this.branchKey(scope));
    return branch === undefined || !this.sameScope(branch.scope, scope)
      ? { ok: false, error: { code: 'NOT_FOUND', message: 'Branch not found' } }
      : { ok: true, value: [...branch.deltas.values()] };
  }

  async discard(scope: BranchMemoryScope): Promise<Result<void>> {
    const branch = this.branches.get(this.branchKey(scope));
    if (branch !== undefined && !this.sameScope(branch.scope, scope)) return { ok: false, error: { code: 'PERMISSION_DENIED', message: 'Scope mismatch' } };
    this.branches.delete(this.branchKey(scope));
    return { ok: true, value: undefined };
  }

  async promote(scope: BranchMemoryScope, deltas: readonly MemoryDelta[], verificationReference: string): Promise<Result<void>> {
    if (verificationReference.length === 0 || deltas.some(({ provenanceReference }) => provenanceReference.length === 0)) {
      return { ok: false, error: { code: 'OBLIGATION_REQUIRED', message: 'Independently verified typed deltas required' } };
    }
    const canonicalScope = { ...scope, branchId: `${scope.treeId}:promoted` };
    await this.create(canonicalScope);
    for (const delta of deltas) await this.write(canonicalScope, delta);
    return { ok: true, value: undefined };
  }

  private branchKey(scope: BranchMemoryScope): string {
    return `${scope.tenantId}:${scope.purpose}:${scope.treeId}:${scope.branchId}`;
  }

  private sameBoundary(a: BranchMemoryScope, b: BranchMemoryScope): boolean {
    return a.tenantId === b.tenantId && a.purpose === b.purpose && a.treeId === b.treeId && a.frozenInputHash === b.frozenInputHash;
  }

  private sameScope(a: BranchMemoryScope, b: BranchMemoryScope): boolean {
    return this.sameBoundary(a, b) && a.branchId === b.branchId;
  }
}

interface AgenticowBranch {
  readonly scope: BranchMemoryScope;
  readonly memory: AgenticMemory;
  readonly deltas: Map<string, MemoryDelta>;
  readonly filePath: string;
}

export class AgenticowBranchMemoryAdapter implements BranchMemoryPort {
  private readonly branches = new Map<string, AgenticowBranch>();

  constructor(private readonly baseDirectory: string) {
    mkdirSync(baseDirectory, { recursive: true });
  }

  async create(scope: BranchMemoryScope, parentBranchId?: string): Promise<Result<void>> {
    const key = this.branchKey(scope);
    const existing = this.branches.get(key);
    if (existing !== undefined) return this.sameScope(existing.scope, scope)
      ? { ok: true, value: undefined }
      : { ok: false, error: { code: 'IDEMPOTENCY_CONFLICT', message: 'Branch scope conflict' } };
    const filePath = join(this.baseDirectory, `${createHash('sha256').update(key).digest('hex')}.rvf`);
    let memory: AgenticMemory;
    if (parentBranchId === undefined) {
      memory = AgenticMemory.open(filePath, { dimension: 8, metric: 'cosine', track: true });
    } else {
      const parent = this.branches.get(this.branchKey({ ...scope, branchId: parentBranchId }));
      if (parent === undefined || !this.sameBoundary(parent.scope, scope)) {
        return { ok: false, error: { code: 'NOT_FOUND', message: 'Parent branch not found in scope' } };
      }
      memory = parent.memory.fork(scope.branchId, filePath);
    }
    this.branches.set(key, { scope: Object.freeze({ ...scope }), memory, deltas: new Map(), filePath });
    return { ok: true, value: undefined };
  }

  async read(scope: BranchMemoryScope, key: string): Promise<Result<Uint8Array | undefined>> {
    const branch = this.branches.get(this.branchKey(scope));
    if (branch === undefined || !this.sameScope(branch.scope, scope)) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Branch not found' } };
    }
    const hits = branch.memory.query(vectorFor(key), 8, { forceExact: true, overscan: 16 });
    const expectedId = idFor(key);
    const hit = hits.find(({ id }) => id === expectedId);
    if (hit?.text === undefined) return { ok: true, value: undefined };
    const decoded = JSON.parse(hit.text) as { key: string; tombstone: boolean; value?: string };
    if (decoded.key !== key || decoded.tombstone || decoded.value === undefined) return { ok: true, value: undefined };
    return { ok: true, value: Buffer.from(decoded.value, 'base64') };
  }

  async write(scope: BranchMemoryScope, delta: MemoryDelta): Promise<Result<void>> {
    const branch = this.branches.get(this.branchKey(scope));
    if (branch === undefined || !this.sameScope(branch.scope, scope)) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Branch not found' } };
    }
    if (!delta.tombstone && delta.value === undefined) {
      return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'Value or tombstone required' } };
    }
    branch.memory.ingest(vectorFor(delta.key), {
      id: idFor(delta.key),
      text: JSON.stringify({
        key: delta.key,
        tombstone: delta.tombstone,
        provenanceReference: delta.provenanceReference,
        ...(delta.value === undefined ? {} : { value: Buffer.from(delta.value).toString('base64') }),
      }),
    });
    branch.deltas.set(delta.key, Object.freeze({ ...delta }));
    return { ok: true, value: undefined };
  }

  async diff(scope: BranchMemoryScope): Promise<Result<readonly MemoryDelta[]>> {
    const branch = this.branches.get(this.branchKey(scope));
    return branch === undefined || !this.sameScope(branch.scope, scope)
      ? { ok: false, error: { code: 'NOT_FOUND', message: 'Branch not found' } }
      : { ok: true, value: [...branch.deltas.values()] };
  }

  async discard(scope: BranchMemoryScope): Promise<Result<void>> {
    const key = this.branchKey(scope);
    const branch = this.branches.get(key);
    if (branch !== undefined) {
      if (!this.sameScope(branch.scope, scope)) return { ok: false, error: { code: 'PERMISSION_DENIED', message: 'Scope mismatch' } };
      branch.memory.close();
      rmSync(branch.filePath, { force: true });
      this.branches.delete(key);
    }
    return { ok: true, value: undefined };
  }

  async promote(
    scope: BranchMemoryScope,
    deltas: readonly MemoryDelta[],
    verificationReference: string,
  ): Promise<Result<void>> {
    if (verificationReference.length === 0 || deltas.some(({ provenanceReference }) => provenanceReference.length === 0)) {
      return { ok: false, error: { code: 'OBLIGATION_REQUIRED', message: 'Independently verified typed deltas required' } };
    }
    const promotedScope = { ...scope, branchId: `${scope.treeId}:promoted` };
    const created = await this.create(promotedScope);
    if (!created.ok) return created;
    for (const delta of deltas) {
      const written = await this.write(promotedScope, delta);
      if (!written.ok) return written;
    }
    return { ok: true, value: undefined };
  }

  private branchKey(scope: BranchMemoryScope): string {
    return `${scope.tenantId}:${scope.purpose}:${scope.treeId}:${scope.branchId}`;
  }

  private sameBoundary(a: BranchMemoryScope, b: BranchMemoryScope): boolean {
    return a.tenantId === b.tenantId && a.purpose === b.purpose
      && a.treeId === b.treeId && a.frozenInputHash === b.frozenInputHash;
  }

  private sameScope(a: BranchMemoryScope, b: BranchMemoryScope): boolean {
    return this.sameBoundary(a, b) && a.branchId === b.branchId;
  }
}

function idFor(key: string): number {
  return createHash('sha256').update(key).digest().readUInt32BE(0);
}

function vectorFor(key: string): Float32Array {
  const digest = createHash('sha256').update(key).digest();
  const vector = new Float32Array(8);
  let magnitude = 0;
  for (let index = 0; index < vector.length; index += 1) {
    const value = ((digest.readInt32BE(index * 4) / 0x7fffffff) || Number.EPSILON);
    vector[index] = value;
    magnitude += value * value;
  }
  const norm = Math.sqrt(magnitude);
  for (let index = 0; index < vector.length; index += 1) vector[index] = (vector[index] ?? 0) / norm;
  return vector;
}
