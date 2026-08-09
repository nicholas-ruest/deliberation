import { createBackend } from 'agentdb/backends';
import type { VectorBackend } from 'agentdb/backends';
import type { Result } from '../../shared/domain/result.js';
import type { EpistemicClass, Sensitivity } from '../domain/entities/evidence-record.js';
import {
  EVIDENCE_INDEX_SCHEMA_VERSION,
  matchesQueryFilters,
  rejectUnindexableEntry,
  type EvidenceIndexEntry,
  type EvidenceIndexScope,
  type EvidenceMatch,
  type EvidenceQuery,
  type EvidenceSearchPort,
} from '../domain/repositories/evidence-search.js';

/**
 * AgentDB dependency qualification (ADR-035) — deliberately NOT eligible.
 *
 * `npm audit` on this lockfile reports 8 high and 22 moderate findings that all reach this
 * repository through this package: `agentdb -> @huggingface/transformers -> onnxruntime-node ->
 * adm-zip` (GHSA-xcpc-8h2w-3j85, a crafted ZIP triggers a 4GB allocation), `@huggingface/
 * transformers -> sharp` inheriting libvips CVE-2026-33327/33328/35590/35591
 * (GHSA-f88m-g3jw-g9cj), and a duplicated OpenTelemetry tree via `agentdb ->
 * @opentelemetry/sdk-node -> @opentelemetry/propagator-jaeger` (malformed-header denial of
 * service). None are fixable without a breaking downgrade, so the `ProductionDependency` for
 * AgentDB stays at `qualifying` and `decide()` denies every use. This adapter is therefore built
 * and contract-tested but unauthorised: it must not be bound in a composition root until the
 * transitive tree is clean. The qualification record lives in
 * `tests/evidence/evidence-search.test.ts`.
 *
 * Two further alpha limitations of `agentdb@3.0.0-alpha.20` shape what is used here:
 *   - Only the `hnswlib` backend honours a configured dimension. `ruvector` and `rvf` reject an
 *     8- or 16-dimension index with "expected 384", so they stay opt-in.
 *   - The package's root entry point does not type-check under `moduleResolution: nodenext`
 *     (TS2835 in `controllers/attention/AttentionHelpers.d.ts` and
 *     `optimizations/BatchOperations.d.ts`). Only the `agentdb/backends` subpath compiles, and
 *     BM25 / `HybridSearch` is exported exclusively from the broken root entry. This adapter is
 *     therefore dense-vector only, which is also the surface ADR-035 scopes in; hybrid retrieval
 *     needs an upstream fix before the port can grow a text-query method.
 *
 * The embedding pipeline (`@huggingface/transformers`) is never invoked — callers supply
 * embeddings — which limits, but does not remove, the exposure, since the packages are installed.
 */
export interface AgentDbEvidenceSearchOptions {
  readonly embeddingDimension: number;
  readonly backend?: 'hnswlib' | 'ruvector' | 'rvf';
  readonly maximumEntriesPerPartition?: number;
}

interface Partition {
  readonly vectors: VectorBackend;
  readonly tombstoned: Set<string>;
}

interface EntryMetadata extends Record<string, unknown> {
  readonly schemaVersion: number;
  readonly tenantId: string;
  readonly purpose: string;
  readonly evidenceId: string;
  readonly recordVersion: number;
  readonly contentHash: string;
  readonly objectId: string;
  readonly epistemicClass: EpistemicClass;
  readonly sensitivity: Sensitivity;
  readonly sourceEventVersion: number;
  readonly redactedSummary?: string;
}

export class AgentDbEvidenceSearchAdapter implements EvidenceSearchPort {
  private readonly partitions = new Map<string, Partition>();

  constructor(private readonly options: AgentDbEvidenceSearchOptions) {}

  async index(scope: EvidenceIndexScope, entry: EvidenceIndexEntry): Promise<Result<void>> {
    const rejection = rejectUnindexableEntry(scope, entry);
    if (rejection !== undefined) return { ok: false, error: rejection };
    if (entry.embedding.length !== this.options.embeddingDimension) {
      return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'Embedding dimension does not match the index' } };
    }

    const partition = await this.partitionFor(scope);
    if (partition.tombstoned.has(entry.evidenceId)) {
      return { ok: false, error: { code: 'DATA_RESTRICTED', message: 'Evidence was erased; re-indexing it is refused' } };
    }

    const metadata: EntryMetadata = {
      schemaVersion: EVIDENCE_INDEX_SCHEMA_VERSION,
      tenantId: scope.tenantId,
      purpose: scope.purpose,
      evidenceId: entry.evidenceId,
      recordVersion: entry.recordVersion,
      contentHash: entry.contentHash,
      objectId: entry.objectId,
      epistemicClass: entry.epistemicClass,
      sensitivity: entry.sensitivity,
      sourceEventVersion: entry.sourceEventVersion,
      ...(entry.redactedSummary === undefined ? {} : { redactedSummary: entry.redactedSummary }),
    };
    partition.vectors.insert(entry.evidenceId, Float32Array.from(entry.embedding), metadata);
    return { ok: true, value: undefined };
  }

  async query(query: EvidenceQuery): Promise<Result<readonly EvidenceMatch[]>> {
    if (query.limit <= 0 || !Number.isSafeInteger(query.limit)) {
      return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'Query limit must be a positive integer' } };
    }
    if (query.embedding.length !== this.options.embeddingDimension) {
      return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'Query embedding dimension does not match the index' } };
    }

    const partition = this.partitions.get(partitionKey(query.scope));
    if (partition === undefined) return { ok: true, value: [] };
    const indexed = partition.vectors.getStats().count;
    if (indexed === 0) return { ok: true, value: [] };

    // The pre-ranking filter is structural: one physical index per tenant+purpose, so another
    // tenant's vectors are never candidates. The metadata filter below is a second, redundant
    // fence — agentdb applies it as post-filtering after top-k truncation, hence the over-fetch.
    const overFetch = Math.min(Math.max(query.limit * 4, 32), indexed);
    const ranked = partition.vectors.search(Float32Array.from(query.embedding), overFetch, {
      filter: { tenantId: query.scope.tenantId, purpose: query.scope.purpose },
    });

    const matches: EvidenceMatch[] = [];
    for (const result of ranked) {
      if (partition.tombstoned.has(result.id)) continue;
      const metadata = result.metadata as EntryMetadata | undefined;
      if (metadata === undefined || metadata.schemaVersion !== EVIDENCE_INDEX_SCHEMA_VERSION) continue;
      if (!matchesQueryFilters(query, metadata)) continue;
      matches.push({
        evidenceId: metadata.evidenceId,
        recordVersion: metadata.recordVersion,
        contentHash: metadata.contentHash,
        objectId: metadata.objectId,
        epistemicClass: metadata.epistemicClass,
        sensitivity: metadata.sensitivity,
        sourceEventVersion: metadata.sourceEventVersion,
        similarity: result.similarity,
        ...(metadata.redactedSummary === undefined ? {} : { redactedSummary: metadata.redactedSummary }),
      });
      if (matches.length === query.limit) break;
    }
    return { ok: true, value: matches };
  }

  async tombstone(scope: EvidenceIndexScope, evidenceId: string): Promise<Result<void>> {
    const partition = await this.partitionFor(scope);
    partition.tombstoned.add(evidenceId);
    partition.vectors.remove(evidenceId);
    return { ok: true, value: undefined };
  }

  async erase(scope: EvidenceIndexScope): Promise<Result<void>> {
    const key = partitionKey(scope);
    const partition = this.partitions.get(key);
    if (partition === undefined) return { ok: true, value: undefined };
    partition.vectors.close();
    this.partitions.delete(key);
    return { ok: true, value: undefined };
  }

  close(): void {
    for (const partition of this.partitions.values()) partition.vectors.close();
    this.partitions.clear();
  }

  private async partitionFor(scope: EvidenceIndexScope): Promise<Partition> {
    const key = partitionKey(scope);
    const existing = this.partitions.get(key);
    if (existing !== undefined) return existing;
    const vectors = await createBackend(this.options.backend ?? 'hnswlib', {
      dimension: this.options.embeddingDimension,
      metric: 'cosine',
      maxElements: this.options.maximumEntriesPerPartition ?? 100_000,
    });
    const partition: Partition = { vectors, tombstoned: new Set() };
    this.partitions.set(key, partition);
    return partition;
  }
}

function partitionKey(scope: EvidenceIndexScope): string {
  return JSON.stringify([EVIDENCE_INDEX_SCHEMA_VERSION, scope.tenantId, scope.purpose]);
}
