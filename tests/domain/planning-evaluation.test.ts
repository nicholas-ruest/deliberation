import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixedClock } from '../../src/shared/domain/index.js';
import { ScenarioTree } from '../../src/scenario-planning/domain/index.js';
import { AgenticowBranchMemoryAdapter, DeltaBranchMemory } from '../../src/scenario-planning/infrastructure/branch-memory.js';
import { EvaluationRun, DecisionBrief } from '../../src/evaluation/domain/index.js';

const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
const manifest = {
  deliberationRevisionHash: 'd',
  preferenceSnapshotHashes: ['p'],
  evidenceSnapshotHashes: ['e'],
  policyVersion: '1',
  safetyCaseVersion: '1',
  routingPolicyVersion: '1',
  connectorSchemaHashes: [],
  reservationId: 'r',
};

describe('scenario planning', () => {
  it('fences expired/cross-tenant leases and logically deduplicates commits', () => {
    const planned = ScenarioTree.plan('tree', 'tenant', 'root', manifest, {
      branches: 3, depth: 2, tokens: 100, moneyMinorUnits: 100, wallTimeMs: 1000, toolCalls: 3, concurrency: 1,
    }, clock);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const tree = planned.value;
    tree.start();
    const lease = { id: 'lease', tenantId: 'tenant', workerId: 'worker', generation: 0, expiresAt: new Date('2026-01-02') };
    expect(tree.lease('root', lease, clock.now()).ok).toBe(true);
    expect(tree.commit('root', 'lease', 1, 'output', { tokens: 10 }, clock.now()).ok).toBe(true);
    expect(tree.commit('root', 'lease', 1, 'output', { tokens: 10 }, clock.now()).ok).toBe(true);
  });

  it('isolates copy-on-write memory across tenants and branches', async () => {
    const memory = new DeltaBranchMemory();
    const scope = { tenantId: 't1', purpose: 'planning', treeId: 'tree', branchId: 'root', frozenInputHash: 'input' };
    await memory.create(scope);
    await memory.write(scope, { key: 'fact', value: Buffer.from('root'), tombstone: false, provenanceReference: 'evidence' });
    const child = { ...scope, branchId: 'child' };
    await memory.create(child, 'root');
    expect((await memory.read(child, 'fact')).ok).toBe(true);
    expect((await memory.read({ ...child, tenantId: 't2' }, 'fact')).ok).toBe(false);
  });

  it('runs the same overlay contract against the pinned Agenticow adapter', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agenticow-contract-'));
    try {
      const memory = new AgenticowBranchMemoryAdapter(directory);
      const scope = { tenantId: 't1', purpose: 'planning', treeId: 'tree', branchId: 'root', frozenInputHash: 'input' };
      expect((await memory.create(scope)).ok).toBe(true);
      expect((await memory.write(scope, {
        key: 'fact', value: Buffer.from('value'), tombstone: false, provenanceReference: 'evidence',
      })).ok).toBe(true);
      const read = await memory.read(scope, 'fact');
      expect(read.ok && Buffer.from(read.value ?? []).toString()).toBe('value');
      const child = { ...scope, branchId: 'child' };
      expect((await memory.create(child, 'root')).ok).toBe(true);
      const inherited = await memory.read(child, 'fact');
      expect(inherited.ok && Buffer.from(inherited.value ?? []).toString()).toBe('value');
      await memory.discard(child);
      await memory.discard(scope);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('evaluation', () => {
  it('applies hard constraints before utility and computes stable Pareto order', () => {
    const planned = EvaluationRun.plan('eval', 'tenant', {
      scenarioManifestHash: 's', evidenceManifestHash: 'e', preferenceManifestHash: 'p', policyManifestHash: 'g',
    }, ['b', 'a'], clock);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const run = planned.value;
    run.start();
    run.recordFinding({
      id: 'f', optionId: 'b', claimId: 'legal', kind: 'policy', status: 'fail',
      evidenceReferences: ['policy'], verifierVersion: '1', rationale: 'illegal',
    }, true);
    run.score({ optionId: 'b', criterionKey: 'value', value: 100, unit: 'points', normalizedUtility: 1, weight: 1, rubricVersion: '1' });
    run.score({ optionId: 'a', criterionKey: 'value', value: 50, unit: 'points', normalizedUtility: 0.5, weight: 1, rubricVersion: '1' });
    expect(run.utility('b')).toBe(Number.NEGATIVE_INFINITY);
    expect(run.paretoFrontier()).toEqual(['a']);
  });

  it('fails brief publication when a material claim lacks citation', () => {
    const brief = DecisionBrief.compose('brief', 'tenant', 'eval', {
      eligibleOptions: ['a'], paretoOptions: ['a'], assumptions: [],
      materialClaims: [{ text: 'claim', evidenceReferences: [] }],
      dissent: [], sensitivitySummary: 'stable', limitations: [], callToAction: 'A human should decide',
    }, clock);
    expect(brief.ok).toBe(false);
  });
});
