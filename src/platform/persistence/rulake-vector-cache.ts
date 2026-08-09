import type { SecretProvider } from '../security/secret-provider.js';
import type { VectorCacheEntry, VectorCacheKey, VectorCachePort } from './vector-cache-port.js';

/**
 * ASSUMED, UNVERIFIED HTTP CONTRACT (ADR-038).
 *
 * `github.com/ruvnet/RuLake` ("a cache-coherent vector execution fabric") has zero GitHub
 * releases and no npm or crates.io package — there is no runnable artifact anywhere to qualify
 * or verify a wire contract against. This adapter targets a minimal, generic key/value-with-
 * versioning HTTP surface consistent with what the project describes ("sits in front of any
 * vector store/lakehouse"); nothing below has been exercised against a live instance. Treat every
 * field name and status code here as a placeholder to replace once a real artifact exists, not as
 * a verified integration.
 *
 *   GET    {base}/cache/{tenantId}/{purpose}/{queryDigest}
 *     -> 200 { "value": <T>, "cachedAt": "<ISO8601>", "sourceVersion": "..." }
 *     -> 404 (miss)
 *   PUT    {base}/cache/{tenantId}/{purpose}/{queryDigest}   body: { value, cachedAt, sourceVersion }
 *     -> 204
 *   DELETE {base}/cache/{tenantId}/{purpose}/{queryDigest}
 *     -> 204
 *   DELETE {base}/cache/{tenantId}/{purpose}
 *     -> 204 (partition invalidation)
 *
 * A cache is disposable by definition (ADR-021): every method here fails open to "treat as a
 * miss" or "best-effort invalidation" rather than raising, so an unreachable or unqualified
 * RuLake instance degrades to InMemoryVectorCache-equivalent behavior (a permanent miss), never
 * to a hard failure of the caller reading the underlying vector store.
 */
export interface RuLakeHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type RuLakeHttpClient = (
  url: string,
  init: { readonly method: 'GET' | 'PUT' | 'DELETE'; readonly headers: Readonly<Record<string, string>>; readonly body?: string; readonly signal: AbortSignal },
) => Promise<RuLakeHttpResponse>;

export interface RuLakeVectorCacheOptions {
  readonly secrets: SecretProvider;
  readonly http?: RuLakeHttpClient;
  readonly timeoutMs?: number;
}

export class RuLakeVectorCache implements VectorCachePort {
  private readonly baseUrl: string;
  private readonly http: RuLakeHttpClient;
  private readonly timeoutMs: number;

  constructor(options: RuLakeVectorCacheOptions) {
    this.baseUrl = options.secrets.require('RULAKE_ENDPOINT').replace(/\/$/, '');
    this.http = options.http ?? (fetch as unknown as RuLakeHttpClient);
    this.timeoutMs = options.timeoutMs ?? 2_000;
  }

  async get<T>(key: VectorCacheKey): Promise<VectorCacheEntry<T> | undefined> {
    try {
      const response = await this.request('GET', this.entryPath(key));
      if (!response.ok) return undefined;
      const body = (await response.json()) as { value: T; cachedAt: string; sourceVersion: string };
      return { value: body.value, cachedAt: new Date(body.cachedAt), sourceVersion: body.sourceVersion };
    } catch {
      return undefined; // a cache is never allowed to turn a miss into a caller-visible failure
    }
  }

  async set<T>(key: VectorCacheKey, entry: VectorCacheEntry<T>): Promise<void> {
    try {
      await this.request('PUT', this.entryPath(key), {
        value: entry.value, cachedAt: entry.cachedAt.toISOString(), sourceVersion: entry.sourceVersion,
      });
    } catch {
      // best-effort: a failed write leaves the cache cold for this key, not the caller broken
    }
  }

  async invalidate(key: VectorCacheKey): Promise<void> {
    try {
      await this.request('DELETE', this.entryPath(key));
    } catch {
      /* best-effort */
    }
  }

  async invalidatePartition(tenantId: string, purpose: string): Promise<void> {
    try {
      await this.request('DELETE', `/cache/${encodeURIComponent(tenantId)}/${encodeURIComponent(purpose)}`);
    } catch {
      /* best-effort */
    }
  }

  private entryPath(key: VectorCacheKey): string {
    return `/cache/${encodeURIComponent(key.tenantId)}/${encodeURIComponent(key.purpose)}/${encodeURIComponent(key.queryDigest)}`;
  }

  private async request(method: 'GET' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<RuLakeHttpResponse> {
    return this.http(`${this.baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }
}
