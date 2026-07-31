import { describe, expect, it } from 'vitest';
import { TamperEvidentAuditLedger } from '../../src/platform/audit/index.js';
import { ErasureProcessManager, type ErasureParticipant, type StorageSurface } from '../../src/governance/application/index.js';
import { evaluateSli, safeAttributes } from '../../src/platform/observability/index.js';

describe('tamper-evident audit', () => {
  it('chains tenant-scoped records and signs an anchor', () => {
    const ledger = new TamperEvidentAuditLedger(Buffer.from('audit-signing-key'));
    ledger.append({
      tenantId: 'tenant', actorId: 'actor', action: 'brief.publish', resourceReference: 'brief',
      outcome: 'succeeded', reasonCode: 'APPROVED', correlationId: 'correlation', occurredAt: new Date('2026-01-01'),
    });
    expect(ledger.verify('tenant')).toBe(true);
    expect(ledger.anchor('tenant').sequence).toBe(1);
    expect(ledger.export('other')).toHaveLength(0);
  });
});

describe('erasure and observability', () => {
  it('requires complete storage-surface coverage before claiming completion', async () => {
    const surfaces: StorageSurface[] = [
      'canonical-records', 'encrypted-blobs', 'projections', 'vector-indexes', 'branch-deltas',
      'caches', 'exports', 'learning-cohorts', 'backups',
    ];
    const participant: ErasureParticipant = {
      owner: 'all-surfaces',
      surfaces,
      restrict: async () => ({ ok: true, value: undefined }),
      discover: async (subject) => ({ ok: true, value: surfaces.map((surface) => ({
        tenantId: subject.tenantId, owner: 'all-surfaces', surface, locator: surface,
      })) }),
      erase: async (item) => ({
        ok: true,
        value: {
          owner: item.owner, surface: item.surface, locatorHash: `hash:${item.locator}`,
          outcome: item.surface === 'backups' ? 'scheduled-backup-expiry' : 'erased',
          completedAt: new Date('2026-01-01'), evidenceDigest: `evidence:${item.surface}`,
        },
      }),
    };
    const report = await new ErasureProcessManager([participant], Buffer.from('erasure-signing-key')).execute('order', {
      tenantId: 'tenant', purposes: ['decision-support'],
    });
    expect(report.status).toBe('completed');
    expect(report.evidence).toHaveLength(9);
  });

  it('rejects sensitive telemetry labels and evaluates numeric objectives', () => {
    expect(() => safeAttributes({ prompt: 'secret text' })).toThrow();
    expect(() => safeAttributes({ message: 'customer evidence under a benign key' })).toThrow();
    const result = evaluateSli({ total: 1000, good: 999, latenciesMs: [10, 20, 30] }, 0.999, 100);
    expect(result.meetsObjective).toBe(true);
  });
});
