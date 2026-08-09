import type { DomainError, Result } from '../../../shared/domain/result.js';
import type { EpistemicClass, Sensitivity } from '../entities/evidence-record.js';

/**
 * ADR-021 requires every projection to declare a schema version. Entries written under an older
 * version are ignored on read rather than reinterpreted, so a rebuild is always the way forward.
 */
export const EVIDENCE_INDEX_SCHEMA_VERSION = 1;

export const SENSITIVITY_ORDER: Readonly<Record<Sensitivity, number>> = Object.freeze({
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
});

/** Tenant + purpose partition. Every operation carries it; nothing in this port is global. */
export interface EvidenceIndexScope {
  readonly tenantId: string;
  readonly purpose: string;
}

/**
 * A derived, disposable index entry — never the canonical `EvidenceRecord`. Content is referenced
 * by `contentHash`/`objectId` only. `redactedSummary` is the already-redacted, sensitivity-cleared
 * display text; the embedding must have been derived from that same cleared content.
 */
export interface EvidenceIndexEntry {
  readonly evidenceId: string;
  readonly recordVersion: number;
  readonly contentHash: string;
  readonly objectId: string;
  readonly epistemicClass: EpistemicClass;
  readonly sensitivity: Sensitivity;
  readonly embedding: readonly number[];
  readonly embeddingModelId: string;
  readonly sourceEventVersion: number;
  readonly redactedSummary?: string;
}

export interface EvidenceQuery {
  readonly scope: EvidenceIndexScope;
  readonly limit: number;
  readonly embedding: readonly number[];
  /** Inclusive ceiling; entries above this sensitivity are never ranked into the response. */
  readonly maximumSensitivity: Sensitivity;
  readonly epistemicClasses?: readonly EpistemicClass[];
}

export interface EvidenceMatch {
  readonly evidenceId: string;
  readonly recordVersion: number;
  readonly contentHash: string;
  readonly objectId: string;
  readonly epistemicClass: EpistemicClass;
  readonly sensitivity: Sensitivity;
  readonly sourceEventVersion: number;
  readonly similarity: number;
  readonly redactedSummary?: string;
}

export interface EvidenceSearchPort {
  index(scope: EvidenceIndexScope, entry: EvidenceIndexEntry): Promise<Result<void>>;
  query(query: EvidenceQuery): Promise<Result<readonly EvidenceMatch[]>>;
  /** ADR-012: makes one record unreachable and refuses any later re-index of the same id. */
  tombstone(scope: EvidenceIndexScope, evidenceId: string): Promise<Result<void>>;
  /** ADR-012: drops the whole partition, index and metadata alike. */
  erase(scope: EvidenceIndexScope): Promise<Result<void>>;
}

/**
 * Shapes that must never reach a search index. Mirrors the sensitive-value guard in
 * `platform/observability/telemetry.ts` (`safeAttributes`) — same threat, different sink: anything
 * an index accepts is later returned to a ranking caller and survives in a rebuildable artifact.
 */
const SECRET_LIKE =
  /-----BEGIN|bearer\s+[\w.\-+/=]{8,}|api[_-]?key|password|client[_-]?secret|\b(?:sk|rk|ghp|ghs|xox[baprs])[-_][A-Za-z0-9]{16,}/i;

export function rejectUnindexableEntry(
  scope: EvidenceIndexScope,
  entry: EvidenceIndexEntry,
): DomainError | undefined {
  if (scope.tenantId.length === 0 || scope.purpose.length === 0) {
    return { code: 'INVALID_ARGUMENT', message: 'Index entries require a tenant and a purpose' };
  }
  if (entry.evidenceId.length === 0 || entry.contentHash.length === 0 || entry.objectId.length === 0
    || entry.embeddingModelId.length === 0) {
    return { code: 'INVALID_ARGUMENT', message: 'Index entries require an opaque content reference and an embedding model id' };
  }
  if (entry.embedding.length === 0 || entry.embedding.some((component) => !Number.isFinite(component))) {
    return { code: 'INVALID_ARGUMENT', message: 'Embeddings must be non-empty and finite' };
  }
  if (entry.sensitivity === 'restricted' && entry.redactedSummary !== undefined) {
    return { code: 'DATA_RESTRICTED', message: 'Restricted evidence is indexed by reference only, never with readable text' };
  }
  if (entry.redactedSummary !== undefined && SECRET_LIKE.test(entry.redactedSummary)) {
    return { code: 'CONTENT_REJECTED', message: 'Index text looks like secret material and was refused' };
  }
  return undefined;
}

/** Post-ranking re-check. ADR-021 applies retrieval filters again before response construction. */
export function matchesQueryFilters(
  query: EvidenceQuery,
  candidate: EvidenceIndexScope & Pick<EvidenceMatch, 'epistemicClass' | 'sensitivity'>,
): boolean {
  return candidate.tenantId === query.scope.tenantId
    && candidate.purpose === query.scope.purpose
    && SENSITIVITY_ORDER[candidate.sensitivity] <= SENSITIVITY_ORDER[query.maximumSensitivity]
    && (query.epistemicClasses === undefined || query.epistemicClasses.includes(candidate.epistemicClass));
}
