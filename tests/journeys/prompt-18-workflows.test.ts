import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Entitlement } from '../../src/commercial-operations/domain/index.js';
import { EvaluationRun, DecisionBrief } from '../../src/evaluation/domain/index.js';
import { ErasureProcessManager, type ErasureParticipant, type StorageSurface } from '../../src/governance/application/index.js';
import { ConnectorGateway } from '../../src/integrations/application/index.js';
import { ConnectorRegistration } from '../../src/integrations/domain/index.js';
import { LearningCandidate } from '../../src/learning/domain/index.js';
import { TamperEvidentAuditLedger } from '../../src/platform/audit/index.js';
import { ScenarioTree } from '../../src/scenario-planning/domain/index.js';
import { FixedClock } from '../../src/shared/domain/index.js';

const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
const budget = {
  branches: 1, depth: 0, tokens: 20, moneyMinorUnits: 10, wallTimeMs: 1000, toolCalls: 1, concurrency: 1,
};
const manifest = {
  deliberationRevisionHash: 'd:1', preferenceSnapshotHashes: ['p:1'], evidenceSnapshotHashes: ['e:1'],
  policyVersion: 'policy:1', safetyCaseVersion: 'safety:1', routingPolicyVersion: 'route:1',
  connectorSchemaHashes: [], reservationId: 'reservation',
};

describe('Prompt 18 integrated acceptance journeys', () => {
  it('abstains without a winner for universal hard failures and publishes unblock conditions', () => {
    const planned = EvaluationRun.plan('evaluation', 'tenant', {
      scenarioManifestHash: 'scenario', evidenceManifestHash: 'evidence',
      preferenceManifestHash: 'preferences', policyManifestHash: 'policy',
    }, ['a', 'b'], clock);
    if (!planned.ok) throw new Error('fixture');
    planned.value.start();
    for (const optionId of ['a', 'b']) {
      expect(planned.value.recordFinding({
        id: `hard-${optionId}`, optionId, claimId: 'legal', kind: 'policy', status: 'fail',
        evidenceReferences: [`evidence-${optionId}`], verifierVersion: 'policy:1', rationale: 'Fails legal constraint',
      }, true).ok).toBe(true);
    }
    expect(planned.value.complete().ok).toBe(true);
    expect(planned.value.state).toBe('abstained');
    expect(planned.value.eligibleOptions()).toEqual([]);
    if (planned.value.abstention === undefined) throw new Error('expected abstention');
    const brief = DecisionBrief.compose('brief', 'tenant', planned.value.id, {
      eligibleOptions: [], paretoOptions: [], assumptions: [], materialClaims: [
        { text: 'Both options fail a hard constraint', evidenceReferences: ['evidence-a', 'evidence-b'] },
      ], dissent: [], sensitivitySummary: 'No eligible option', limitations: ['No winner selected'],
      callToAction: 'An authorized human should revise the options or constraints.',
      abstention: planned.value.abstention,
    }, clock);
    expect(brief.ok && brief.value.publish().ok).toBe(true);
    expect(brief.ok && brief.value.content.abstention?.unblockConditions).toContain('Revise options or constraints');
  });

  it('cancels admission, fences late commits, releases unused quota, and records content-free audit evidence', () => {
    const entitlement = Entitlement.create('entitlement', 'tenant', ['planning'], clock);
    for (const [dimension, hardLimit] of Object.entries(budget)) {
      if (dimension === 'depth') continue;
      entitlement.setQuota(dimension as Exclude<keyof typeof budget, 'depth'>, { hardLimit, allowOverage: false });
    }
    const request = {
      tokens: budget.tokens, moneyMinorUnits: budget.moneyMinorUnits, toolCalls: budget.toolCalls,
      branches: budget.branches, wallTimeMs: budget.wallTimeMs, concurrency: budget.concurrency,
    };
    expect(entitlement.reserve('reservation', request, new Date('2026-01-02'), clock.now()).ok).toBe(true);
    const tree = ScenarioTree.plan('tree', 'tenant', 'root', manifest, budget, clock);
    if (!tree.ok) throw new Error('fixture');
    tree.value.start();
    tree.value.lease('root', {
      id: 'lease', tenantId: 'tenant', workerId: 'worker', generation: 0, expiresAt: new Date('2026-01-02'),
    }, clock.now());
    tree.value.cancel();
    expect(tree.value.lease('root', {
      id: 'late', tenantId: 'tenant', workerId: 'worker', generation: 0, expiresAt: new Date('2026-01-02'),
    }, clock.now()).ok).toBe(false);
    expect(tree.value.commit('root', 'lease', 1, 'late-output', { tokens: 1 }, clock.now()).ok).toBe(false);
    expect(entitlement.release('reservation')).toMatchObject({ ok: true, value: { state: 'released' } });
    const ledger = new TamperEvidentAuditLedger(Buffer.from('journey-audit-signing-key'));
    ledger.append({
      tenantId: 'tenant', actorId: 'user', action: 'scenario.cancel', resourceReference: 'tree',
      outcome: 'succeeded', reasonCode: 'USER_CANCELLED', correlationId: 'correlation', occurredAt: clock.now(),
    });
    expect(ledger.verify('tenant')).toBe(true);
    expect(JSON.stringify(ledger.export('tenant'))).not.toContain('late-output');
  });

  it('withdraws access first and produces signed erasure evidence across all surfaces with legal holds', async () => {
    const surfaces: StorageSurface[] = [
      'canonical-records', 'encrypted-blobs', 'projections', 'vector-indexes', 'branch-deltas',
      'caches', 'exports', 'learning-cohorts', 'backups',
    ];
    let restricted = false;
    const participant: ErasureParticipant = {
      owner: 'storage-registry',
      surfaces,
      restrict: async () => { restricted = true; return { ok: true, value: undefined }; },
      discover: async (subject) => {
        expect(restricted).toBe(true);
        return { ok: true, value: surfaces.map((surface) => ({
          tenantId: subject.tenantId, owner: 'storage-registry', surface, locator: `opaque:${surface}`,
          ...(surface === 'canonical-records' ? { legalHoldReference: 'hold:1' } : {}),
        })) };
      },
      erase: async (item) => ({
        ok: true,
        value: {
          owner: item.owner, surface: item.surface,
          locatorHash: createHash('sha256').update(item.locator).digest('hex'),
          outcome: item.surface === 'backups' ? 'scheduled-backup-expiry' : 'erased',
          completedAt: clock.now(), evidenceDigest: createHash('sha256').update(item.surface).digest('hex'),
        },
      }),
    };
    const key = Buffer.from('erasure-report-key-material');
    const report = await new ErasureProcessManager([participant], key).execute('erase:1', {
      tenantId: 'tenant', subjectId: 'subject', purposes: ['planning'],
    });
    expect(report.status).toBe('completed');
    expect(report.evidence).toHaveLength(9);
    expect(report.evidence.find(({ surface }) => surface === 'canonical-records')?.outcome).toBe('restricted-under-hold');
    expect(report.evidence.find(({ surface }) => surface === 'backups')?.outcome).toBe('scheduled-backup-expiry');
    expect(report.signature).toBe(createHmac('sha256', key).update(report.reportDigest).digest('hex'));
  });

  it('quarantines a compromised connector, fails new calls closed, and rejects in-flight results', async () => {
    const registration = ConnectorRegistration.register({
      id: 'connector', tenantId: 'tenant', endpointIdentity: 'sha256:identity',
      transport: 'streamable-http', credentialReference: 'secret://connector', allowedHosts: ['safe.example'],
    }, clock);
    if (!registration.ok) throw new Error('fixture');
    registration.value.discover({ name: 'read', schemaHash: 'schema:1', capabilityClass: 'read' });
    registration.value.approve('read', 'schema:1', 'reviewer', clock.now());
    let resolve!: (value: unknown) => void;
    const client = { call: vi.fn(() => new Promise((done) => { resolve = done; })) };
    const gateway = new ConnectorGateway(registration.value, client);
    const invocation = {
      tenantId: 'tenant', capability: 'read', schemaHash: 'schema:1', capabilityClass: 'read' as const,
      targetHost: 'safe.example', purpose: 'evidence', input: {},
    };
    const pending = gateway.invoke(invocation, {
      effect: 'allow', obligations: [], policySetId: 'policy', policyVersion: 1,
    }, z.object({ value: z.string() }));
    gateway.quarantine();
    resolve({ value: 'untrusted' });
    expect((await pending).ok).toBe(false);
    expect((await gateway.invoke(invocation, {
      effect: 'allow', obligations: [], policySetId: 'policy', policyVersion: 1,
    }, z.object({ value: z.string() }))).ok).toBe(false);
    expect(registration.value.credentialReference).toBe('secret://connector');
  });

  it('rolls a regressed learning canary back to the signed prior artifact and preserves forensic state', () => {
    const candidate = LearningCandidate.propose('candidate:v2', 'tenant', 'author', 'route', 'derivation:v2', clock);
    candidate.attachEvaluation([
      { name: 'calibration', candidate: 0.9, baseline: 0.9, direction: 'higher-is-better', requiredNonRegression: true },
      { name: 'fairness', candidate: 1, baseline: 1, direction: 'higher-is-better', requiredNonRegression: true },
    ]);
    candidate.approve('independent-reviewer', 'signed:candidate:v2', 'signed:candidate:v1');
    candidate.startCanary({ minimumObservations: 100, maximumFailureRate: 0 });
    candidate.observeCanary(true);
    expect(candidate.state).toBe('rolled-back');
    expect(candidate.rollbackTarget()).toEqual({ ok: true, value: 'signed:candidate:v1' });
    expect(candidate.signedArtifactDigest).toBe('signed:candidate:v2');
    expect(candidate.approve('another-reviewer', 'signed:candidate:v2', 'signed:candidate:v1').ok).toBe(false);
  });
});
