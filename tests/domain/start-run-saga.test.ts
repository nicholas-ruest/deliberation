import { describe, expect, it, vi } from 'vitest';
import { ScenarioTree } from '../../src/scenario-planning/domain/index.js';
import { StartRunSaga } from '../../src/scenario-planning/application/index.js';
import { FixedClock } from '../../src/shared/domain/index.js';

const request = {
  workflowId: 'workflow', tenantId: 'tenant', caseId: 'case', revision: 1, rootBranchId: 'root',
  budget: { branches: 1, depth: 1, tokens: 10, moneyMinorUnits: 10, wallTimeMs: 10, toolCalls: 1, concurrency: 1 },
};

describe('start run saga', () => {
  it('executes validation, authorization, reservation, freeze, create in exact order', async () => {
    const order: string[] = [];
    const saga = new StartRunSaga({
      validateDeliberation: async () => { order.push('validate'); return { ok: true, value: { revisionHash: 'd' } }; },
      authorize: async () => { order.push('authorize'); return { ok: true, value: { policyVersion: 'p', safetyCaseVersion: 's' } }; },
      reserve: async () => { order.push('reserve'); return { ok: true, value: { reservationId: 'r' } }; },
      releaseReservation: async () => { order.push('release'); return { ok: true, value: undefined }; },
      freezeInputs: async () => {
        order.push('freeze');
        return { ok: true, value: {
          preferenceSnapshotHashes: ['p'], evidenceSnapshotHashes: ['e'], routingPolicyVersion: 'm', connectorSchemaHashes: [],
        } };
      },
      createTree: async (_request, manifest) => {
        order.push('create');
        return ScenarioTree.plan('tree', 'tenant', 'root', manifest, request.budget, new FixedClock(new Date('2026-01-01')));
      },
    });
    expect((await saga.execute(request)).ok).toBe(true);
    expect(order).toEqual(['validate', 'authorize', 'reserve', 'freeze', 'create']);
  });

  it('releases reservation after a post-reservation failure', async () => {
    const release = vi.fn(async () => ({ ok: true as const, value: undefined }));
    const saga = new StartRunSaga({
      validateDeliberation: async () => ({ ok: true, value: { revisionHash: 'd' } }),
      authorize: async () => ({ ok: true, value: { policyVersion: 'p', safetyCaseVersion: 's' } }),
      reserve: async () => ({ ok: true, value: { reservationId: 'r' } }),
      releaseReservation: release,
      freezeInputs: async () => ({ ok: false, error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'failed', retryable: true } }),
      createTree: async () => { throw new Error('must not execute'); },
    });
    expect((await saga.execute(request)).ok).toBe(false);
    expect(release).toHaveBeenCalledWith('r');
  });
});
