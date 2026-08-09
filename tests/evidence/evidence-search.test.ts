import { afterAll, describe, expect, it } from 'vitest';
import { ProductionDependency } from '../../src/integrations/domain/entities/index.js';
import {
  EVIDENCE_INDEX_SCHEMA_VERSION,
  matchesQueryFilters,
  rejectUnindexableEntry,
  type EvidenceIndexEntry,
  type EvidenceIndexScope,
  type EvidenceMatch,
  type EvidenceQuery,
  type EvidenceSearchPort,
} from '../../src/evidence/domain/repositories/evidence-search.js';
import { AgentDbEvidenceSearchAdapter } from '../../src/evidence/infrastructure/agentdb-search.js';

const DIMENSION = 8;

const vector = (...leading: number[]): readonly number[] => {
  const components = new Array<number>(DIMENSION).fill(0);
  leading.forEach((component, position) => { components[position] = component; });
  const norm = Math.sqrt(components.reduce((total, component) => total + component * component, 0)) || 1;
  return components.map((component) => component / norm);
};

const scope = (tenantId: string, purpose = 'deliberation'): EvidenceIndexScope => ({ tenantId, purpose });

const entry = (overrides: Partial<EvidenceIndexEntry> & { evidenceId: string }): EvidenceIndexEntry => ({
  recordVersion: 1,
  contentHash: `sha256:${overrides.evidenceId}`,
  objectId: `object/${overrides.evidenceId}`,
  epistemicClass: 'observed-fact',
  sensitivity: 'internal',
  embedding: vector(1),
  embeddingModelId: 'test-embedder-2026-08-01',
  sourceEventVersion: 3,
  ...overrides,
});

/**
 * The second adapter behind the port (ADR-007's pattern): no vector library, pure arithmetic.
 * If the contract suite passes here and against AgentDB, the port is genuinely swappable.
 */
class InMemoryEvidenceSearch implements EvidenceSearchPort {
  private readonly partitions = new Map<string, { entries: Map<string, EvidenceIndexEntry>; tombstoned: Set<string> }>();

  async index(target: EvidenceIndexScope, candidate: EvidenceIndexEntry) {
    const rejection = rejectUnindexableEntry(target, candidate);
    if (rejection !== undefined) return { ok: false as const, error: rejection };
    const partition = this.partitionFor(target);
    if (partition.tombstoned.has(candidate.evidenceId)) {
      return { ok: false as const, error: { code: 'DATA_RESTRICTED' as const, message: 'Evidence was erased; re-indexing it is refused' } };
    }
    partition.entries.set(candidate.evidenceId, candidate);
    return { ok: true as const, value: undefined };
  }

  async query(request: EvidenceQuery) {
    if (request.limit <= 0) {
      return { ok: false as const, error: { code: 'INVALID_ARGUMENT' as const, message: 'Query limit must be a positive integer' } };
    }
    const partition = this.partitions.get(key(request.scope));
    const matches: EvidenceMatch[] = [];
    for (const candidate of partition?.entries.values() ?? []) {
      if (!matchesQueryFilters(request, { ...request.scope, epistemicClass: candidate.epistemicClass, sensitivity: candidate.sensitivity })) continue;
      const similarity = cosine(request.embedding, candidate.embedding);
      if (similarity <= 0) continue;
      matches.push({
        evidenceId: candidate.evidenceId, recordVersion: candidate.recordVersion, contentHash: candidate.contentHash,
        objectId: candidate.objectId, epistemicClass: candidate.epistemicClass, sensitivity: candidate.sensitivity,
        sourceEventVersion: candidate.sourceEventVersion, similarity,
        ...(candidate.redactedSummary === undefined ? {} : { redactedSummary: candidate.redactedSummary }),
      });
    }
    matches.sort((left, right) => right.similarity - left.similarity);
    return { ok: true as const, value: matches.slice(0, request.limit) };
  }

  async tombstone(target: EvidenceIndexScope, evidenceId: string) {
    const partition = this.partitionFor(target);
    partition.tombstoned.add(evidenceId);
    partition.entries.delete(evidenceId);
    return { ok: true as const, value: undefined };
  }

  async erase(target: EvidenceIndexScope) {
    this.partitions.delete(key(target));
    return { ok: true as const, value: undefined };
  }

  private partitionFor(target: EvidenceIndexScope) {
    const existing = this.partitions.get(key(target));
    if (existing !== undefined) return existing;
    const created = { entries: new Map<string, EvidenceIndexEntry>(), tombstoned: new Set<string>() };
    this.partitions.set(key(target), created);
    return created;
  }
}

const key = (target: EvidenceIndexScope): string => JSON.stringify([target.tenantId, target.purpose]);

function cosine(left: readonly number[], right: readonly number[]): number {
  let dot = 0;
  for (let position = 0; position < Math.min(left.length, right.length); position += 1) {
    dot += (left[position] ?? 0) * (right[position] ?? 0);
  }
  return dot;
}

const agentDb = new AgentDbEvidenceSearchAdapter({ embeddingDimension: DIMENSION });
afterAll(() => { agentDb.close(); });

const adapters: readonly (readonly [string, EvidenceSearchPort])[] = [
  ['in-memory', new InMemoryEvidenceSearch()],
  ['agentdb', agentDb],
];

describe.each(adapters)('EvidenceSearchPort contract (%s)', (name, port) => {
  // The AgentDB adapter is shared across the whole file, so each case owns a distinct tenant.
  const tenant = (suffix: string): string => `${name}-${suffix}`;

  it('returns indexed evidence by similarity, carrying source id, version, class, and sensitivity', async () => {
    const target = scope(tenant('recall'));
    expect((await port.index(target, entry({ evidenceId: 'e-near', embedding: vector(1) }))).ok).toBe(true);
    expect((await port.index(target, entry({ evidenceId: 'e-far', embedding: vector(0, 1) }))).ok).toBe(true);

    const found = await port.query({ scope: target, limit: 5, maximumSensitivity: 'restricted', embedding: vector(1) });
    expect(found.ok).toBe(true);
    if (!found.ok) throw new Error('unreachable');
    expect(found.value[0]?.evidenceId).toBe('e-near');
    expect(found.value[0]?.recordVersion).toBe(1);
    expect(found.value[0]?.contentHash).toBe('sha256:e-near');
    expect(found.value[0]?.objectId).toBe('object/e-near');
    expect(found.value[0]?.sourceEventVersion).toBe(3);
    expect(found.value[0]?.epistemicClass).toBe('observed-fact');
    expect(found.value[0]?.sensitivity).toBe('internal');
    expect(found.value[0]?.similarity).toBeGreaterThan(0.99);
  });

  it('never returns another tenant or another purpose', async () => {
    const mine = scope(tenant('isolated'));
    const theirs = scope(tenant('other-tenant'));
    const otherPurpose = scope(tenant('isolated'), 'audit');
    await port.index(theirs, entry({ evidenceId: 'their-dossier', embedding: vector(1) }));
    await port.index(otherPurpose, entry({ evidenceId: 'audit-only', embedding: vector(1) }));
    await port.index(mine, entry({ evidenceId: 'mine', embedding: vector(1) }));

    const found = await port.query({ scope: mine, limit: 10, maximumSensitivity: 'restricted', embedding: vector(1) });
    if (!found.ok) throw new Error('unreachable');
    expect(found.value.map(({ evidenceId }) => evidenceId)).toEqual(['mine']);

    const theirView = await port.query({ scope: theirs, limit: 10, maximumSensitivity: 'restricted', embedding: vector(1) });
    if (!theirView.ok) throw new Error('unreachable');
    expect(theirView.value.map(({ evidenceId }) => evidenceId)).toEqual(['their-dossier']);

    const empty = await port.query({ scope: scope(tenant('never-indexed')), limit: 10, maximumSensitivity: 'restricted', embedding: vector(1) });
    if (!empty.ok) throw new Error('unreachable');
    expect(empty.value).toEqual([]);
  });

  it('applies the sensitivity ceiling and epistemic-class filter to the ranked response', async () => {
    const target = scope(tenant('filters'));
    await port.index(target, entry({ evidenceId: 'public-fact', sensitivity: 'public', embedding: vector(1, 0.01) }));
    await port.index(target, entry({ evidenceId: 'confidential-estimate', sensitivity: 'confidential', epistemicClass: 'estimate', embedding: vector(1, 0.02) }));

    const capped = await port.query({ scope: target, limit: 10, maximumSensitivity: 'internal', embedding: vector(1) });
    if (!capped.ok) throw new Error('unreachable');
    expect(capped.value.map(({ evidenceId }) => evidenceId)).toEqual(['public-fact']);

    const byClass = await port.query({ scope: target, limit: 10, maximumSensitivity: 'restricted', epistemicClasses: ['estimate'], embedding: vector(1) });
    if (!byClass.ok) throw new Error('unreachable');
    expect(byClass.value.map(({ evidenceId }) => evidenceId)).toEqual(['confidential-estimate']);
  });

  it('returns the redacted summary and honours the result limit', async () => {
    const target = scope(tenant('summaries'));
    await port.index(target, entry({ evidenceId: 'summarised', redactedSummary: 'quarterly emissions disclosure', embedding: vector(1) }));
    await port.index(target, entry({ evidenceId: 'also-close', embedding: vector(1, 0.05) }));

    const found = await port.query({ scope: target, limit: 1, maximumSensitivity: 'restricted', embedding: vector(1) });
    if (!found.ok) throw new Error('unreachable');
    expect(found.value).toHaveLength(1);
    expect(found.value[0]?.evidenceId).toBe('summarised');
    expect(found.value[0]?.redactedSummary).toBe('quarterly emissions disclosure');
  });

  it('tombstones erased evidence and refuses to resurrect it on replay', async () => {
    const target = scope(tenant('erasure'));
    await port.index(target, entry({ evidenceId: 'forgotten', embedding: vector(1) }));
    expect((await port.tombstone(target, 'forgotten')).ok).toBe(true);

    const found = await port.query({ scope: target, limit: 5, maximumSensitivity: 'restricted', embedding: vector(1) });
    if (!found.ok) throw new Error('unreachable');
    expect(found.value).toEqual([]);

    const replayed = await port.index(target, entry({ evidenceId: 'forgotten', embedding: vector(1) }));
    expect(replayed.ok).toBe(false);
    if (replayed.ok) throw new Error('unreachable');
    expect(replayed.error.code).toBe('DATA_RESTRICTED');
  });

  it('erases a whole partition', async () => {
    const target = scope(tenant('purge'));
    await port.index(target, entry({ evidenceId: 'transient', embedding: vector(1) }));
    expect((await port.erase(target)).ok).toBe(true);
    const found = await port.query({ scope: target, limit: 5, maximumSensitivity: 'restricted', embedding: vector(1) });
    if (!found.ok) throw new Error('unreachable');
    expect(found.value).toEqual([]);
  });

  it('refuses to index secret-looking text, restricted readable text, and malformed entries', async () => {
    const target = scope(tenant('rejections'));
    const cases: readonly (readonly [EvidenceIndexEntry, string])[] = [
      [entry({ evidenceId: 'leak-1', redactedSummary: 'connection string uses password hunter2hunter2' }), 'CONTENT_REJECTED'],
      [entry({ evidenceId: 'leak-2', redactedSummary: 'Authorization: Bearer abcdef0123456789abcdef' }), 'CONTENT_REJECTED'],
      [entry({ evidenceId: 'leak-3', redactedSummary: '-----BEGIN PRIVATE KEY-----' }), 'CONTENT_REJECTED'],
      [entry({ evidenceId: 'leak-4', redactedSummary: 'rotate sk-0123456789abcdefghij today' }), 'CONTENT_REJECTED'],
      [entry({ evidenceId: 'leak-5', sensitivity: 'restricted', redactedSummary: 'patient intake notes' }), 'DATA_RESTRICTED'],
      [entry({ evidenceId: 'bad-1', embedding: [] }), 'INVALID_ARGUMENT'],
      [entry({ evidenceId: 'bad-2', embedding: vector(1).map(() => Number.NaN) }), 'INVALID_ARGUMENT'],
      [entry({ evidenceId: 'bad-3', contentHash: '' }), 'INVALID_ARGUMENT'],
      [entry({ evidenceId: 'bad-4', embeddingModelId: '' }), 'INVALID_ARGUMENT'],
      [entry({ evidenceId: 'bad-5', objectId: '' }), 'INVALID_ARGUMENT'],
    ];
    for (const [candidate, code] of cases) {
      const outcome = await port.index(target, candidate);
      expect(outcome.ok, candidate.evidenceId).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.error.code, candidate.evidenceId).toBe(code);
    }

    const found = await port.query({ scope: target, limit: 20, maximumSensitivity: 'restricted', embedding: vector(1) });
    if (!found.ok) throw new Error('unreachable');
    expect(found.value).toEqual([]);
  });

  it('rejects an entry indexed without a tenant or purpose, and a non-positive limit', async () => {
    const scopeless = await port.index({ tenantId: '', purpose: '' }, entry({ evidenceId: 'nowhere' }));
    expect(scopeless.ok).toBe(false);
    if (scopeless.ok) throw new Error('unreachable');
    expect(scopeless.error.code).toBe('INVALID_ARGUMENT');

    const badLimit = await port.query({ scope: scope(tenant('bad-queries')), limit: 0, maximumSensitivity: 'internal', embedding: vector(1) });
    expect(badLimit.ok).toBe(false);
  });
});

describe('AgentDB adapter specifics', () => {
  it('rejects embeddings whose dimension does not match the index', async () => {
    const outcome = await agentDb.index(scope('dimension-check'), entry({ evidenceId: 'wrong-width', embedding: [1, 0] }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.error.code).toBe('INVALID_ARGUMENT');

    const query = await agentDb.query({ scope: scope('dimension-check'), limit: 3, maximumSensitivity: 'internal', embedding: [1, 0] });
    expect(query.ok).toBe(false);
  });

  it('declares a schema version so a rebuild, not a reinterpretation, is the upgrade path', () => {
    expect(EVIDENCE_INDEX_SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
  });
});

/**
 * ADR-035 qualification record. Held at `qualifying` on purpose: `npm audit` reports 8 high and 22
 * moderate findings reaching this repository through `agentdb` — `@huggingface/transformers ->
 * onnxruntime-node -> adm-zip` (GHSA-xcpc-8h2w-3j85), `sharp`/libvips (GHSA-f88m-g3jw-g9cj), and a
 * duplicated OpenTelemetry tree via `@opentelemetry/sdk-node -> @opentelemetry/propagator-jaeger`.
 * None resolve without a breaking downgrade, so nothing may authorise a call through this adapter.
 */
const agentDbDependency = (): ProductionDependency => new ProductionDependency({
  id: 'agentdb-evidence-search', version: 1, immutableProviderVersion: '3.0.0-alpha.20', owner: 'evidence',
  purpose: 'evidence-similarity-search', dataClasses: ['internal'], regions: ['eu-1'], retentionDays: 0,
  permitsTraining: false, fixtureHash: 'none', killSwitchId: 'agentdb-evidence-search',
  exitPlan: 'Not qualifiable today: npm audit reports 8 high / 22 moderate findings introduced transitively by '
    + 'agentdb (adm-zip GHSA-xcpc-8h2w-3j85 via onnxruntime-node, sharp/libvips GHSA-f88m-g3jw-g9cj, and the '
    + 'duplicated OpenTelemetry tree via @opentelemetry/sdk-node), none fixable without a breaking downgrade. '
    + 'Exit is deleting the adapter and keeping EvidenceSearchPort; no call site depends on it.',
  reviewedAt: new Date('2026-08-09'), expiresAt: new Date('2026-11-09'), driftFingerprint: 'unqualified',
});

describe('ADR-035 AgentDB dependency qualification', () => {
  it('stays short of eligible and denies every use while the audit findings stand', () => {
    const dependency = agentDbDependency();
    expect(dependency.state).toBe('draft');
    dependency.startQualification();
    expect(dependency.state).toBe('qualifying');

    const decision = dependency.decide('eu-1', 'internal', new Date('2026-08-09'), 'unqualified');
    expect(decision.ok).toBe(false);
    if (decision.ok) throw new Error('unreachable');
    expect(decision.error.code).toBe('DEPENDENCY_UNAVAILABLE');
    expect(dependency.state).not.toBe('eligible');
  });
});
