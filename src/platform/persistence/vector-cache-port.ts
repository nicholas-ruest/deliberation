export interface VectorCacheKey {
  readonly tenantId: string;
  readonly purpose: string;
  /** A digest of the query (embedding + filters), never the raw embedding as a cache key. */
  readonly queryDigest: string;
}

export interface VectorCacheEntry<T> {
  readonly value: T;
  readonly cachedAt: Date;
  /** ADR-021: every cache entry declares the source version it was derived from. */
  readonly sourceVersion: string;
}

/**
 * A disposable, rebuildable acceleration layer in front of a vector store (ADR-021, ADR-038) —
 * never a source of truth. Any implementation must be safe to lose entirely: a cache miss falls
 * back to the underlying store, never to a hard failure.
 */
export interface VectorCachePort {
  get<T>(key: VectorCacheKey): Promise<VectorCacheEntry<T> | undefined>;
  set<T>(key: VectorCacheKey, entry: VectorCacheEntry<T>): Promise<void>;
  invalidate(key: VectorCacheKey): Promise<void>;
  /** Drops every entry for one tenant+purpose partition — rebuild, revocation, or erasure. */
  invalidatePartition(tenantId: string, purpose: string): Promise<void>;
}

function partitionKey(tenantId: string, purpose: string): string {
  return `${tenantId}:${purpose}`;
}

function cacheKey(key: VectorCacheKey): string {
  return `${partitionKey(key.tenantId, key.purpose)}:${key.queryDigest}`;
}

/**
 * Working baseline adapter — not a stub. Suitable as the unconditional default: correct,
 * dependency-free, and exactly as disposable as ADR-021 requires. A qualified external cache
 * fabric (RuLake or otherwise) is a drop-in replacement behind the same port, adopted only where
 * a measured cache-miss cost justifies it (ADR-038), mirroring how ADR-007 treats agenticow as
 * an optional adapter behind `BranchMemoryPort` rather than the only implementation.
 */
export class InMemoryVectorCache implements VectorCachePort {
  private readonly entries = new Map<string, VectorCacheEntry<unknown>>();

  async get<T>(key: VectorCacheKey): Promise<VectorCacheEntry<T> | undefined> {
    return this.entries.get(cacheKey(key)) as VectorCacheEntry<T> | undefined;
  }

  async set<T>(key: VectorCacheKey, entry: VectorCacheEntry<T>): Promise<void> {
    this.entries.set(cacheKey(key), entry);
  }

  async invalidate(key: VectorCacheKey): Promise<void> {
    this.entries.delete(cacheKey(key));
  }

  async invalidatePartition(tenantId: string, purpose: string): Promise<void> {
    const prefix = `${partitionKey(tenantId, purpose)}:`;
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }
}
