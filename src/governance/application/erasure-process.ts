import { createHash, createHmac } from 'node:crypto';
import type { Result } from '../../shared/domain/result.js';

export type StorageSurface =
  | 'canonical-records'
  | 'encrypted-blobs'
  | 'projections'
  | 'vector-indexes'
  | 'branch-deltas'
  | 'caches'
  | 'exports'
  | 'learning-cohorts'
  | 'backups';

export interface ErasureSubject {
  readonly tenantId: string;
  readonly subjectId?: string;
  readonly resourceIds?: readonly string[];
  readonly purposes: readonly string[];
}

export interface ErasureItem {
  readonly tenantId: string;
  readonly owner: string;
  readonly surface: StorageSurface;
  readonly locator: string;
  readonly legalHoldReference?: string;
}

export interface ErasureEvidence {
  readonly owner: string;
  readonly surface: StorageSurface;
  readonly locatorHash: string;
  readonly outcome: 'erased' | 'restricted-under-hold' | 'scheduled-backup-expiry' | 'not-found';
  readonly completedAt: Date;
  readonly evidenceDigest: string;
}

export interface ErasureParticipant {
  readonly owner: string;
  readonly surfaces: readonly StorageSurface[];
  restrict(subject: ErasureSubject): Promise<Result<void>>;
  discover(subject: ErasureSubject): Promise<Result<readonly ErasureItem[]>>;
  erase(item: ErasureItem): Promise<Result<ErasureEvidence>>;
}

export interface ErasureReport {
  readonly orderId: string;
  readonly tenantId: string;
  readonly status: 'completed' | 'completed-with-exceptions' | 'failed';
  readonly evidence: readonly ErasureEvidence[];
  readonly exceptions: readonly { owner: string; surface?: StorageSurface; code: string }[];
  readonly reportDigest: string;
  readonly signature: string;
}

const requiredSurfaces = new Set<StorageSurface>([
  'canonical-records', 'encrypted-blobs', 'projections', 'vector-indexes', 'branch-deltas',
  'caches', 'exports', 'learning-cohorts', 'backups',
]);

export class ErasureProcessManager {
  constructor(
    private readonly participants: readonly ErasureParticipant[],
    private readonly signingKey: Uint8Array,
  ) {
    if (signingKey.byteLength < 16) throw new Error('Erasure report signing key is too short');
  }

  coverage(): Result<void> {
    const covered = new Set(this.participants.flatMap(({ surfaces }) => surfaces));
    const missing = [...requiredSurfaces].filter((surface) => !covered.has(surface));
    return missing.length === 0
      ? { ok: true, value: undefined }
      : { ok: false, error: { code: 'INVARIANT_VIOLATION', message: 'Erasure surface registry incomplete', details: { missing } } };
  }

  async execute(orderId: string, subject: ErasureSubject): Promise<ErasureReport> {
    const coverage = this.coverage();
    if (!coverage.ok) return this.report(orderId, subject.tenantId, [], [{ owner: 'registry', code: coverage.error.code }]);
    const evidence: ErasureEvidence[] = [];
    const exceptions: { owner: string; surface?: StorageSurface; code: string }[] = [];
    for (const participant of this.participants) {
      const restricted = await participant.restrict(subject);
      if (!restricted.ok) {
        exceptions.push({ owner: participant.owner, code: restricted.error.code });
        continue;
      }
      const discovered = await participant.discover(subject);
      if (!discovered.ok) {
        exceptions.push({ owner: participant.owner, code: discovered.error.code });
        continue;
      }
      for (const item of discovered.value) {
        if (item.tenantId !== subject.tenantId || item.owner !== participant.owner || !participant.surfaces.includes(item.surface)) {
          exceptions.push({ owner: participant.owner, surface: item.surface, code: 'INVALID_ERASURE_EVIDENCE_SCOPE' });
          continue;
        }
        if (item.legalHoldReference !== undefined) {
          const locatorHash = createHash('sha256').update(item.locator).digest('hex');
          const body = `${item.owner}:${item.surface}:${locatorHash}:restricted-under-hold`;
          evidence.push({
            owner: item.owner,
            surface: item.surface,
            locatorHash,
            outcome: 'restricted-under-hold',
            completedAt: new Date(),
            evidenceDigest: createHash('sha256').update(body).digest('hex'),
          });
          continue;
        }
        const erased = await participant.erase(item);
        if (erased.ok) evidence.push(erased.value);
        else exceptions.push({ owner: participant.owner, surface: item.surface, code: erased.error.code });
      }
    }
    return this.report(orderId, subject.tenantId, evidence, exceptions);
  }

  private report(
    orderId: string,
    tenantId: string,
    evidence: readonly ErasureEvidence[],
    exceptions: readonly { owner: string; surface?: StorageSurface; code: string }[],
  ): ErasureReport {
    const status: ErasureReport['status'] = exceptions.length === 0
      ? 'completed'
      : evidence.length > 0
        ? 'completed-with-exceptions'
        : 'failed';
    const body = { orderId, tenantId, status, evidence, exceptions };
    const reportDigest = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const signature = createHmac('sha256', this.signingKey).update(reportDigest).digest('hex');
    return Object.freeze({ ...body, reportDigest, signature });
  }
}
