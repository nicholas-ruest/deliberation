import { describe, expect, it } from 'vitest';
import { DecisionLaboratory } from '../../src/platform/laboratory/index.js';
import { FixedClock } from '../../src/shared/domain/index.js';

const clock = new FixedClock(new Date('2026-01-01'));
const base = {
  tenantId: 'tenant',
  title: 'Choose a supplier',
  contract: {
    question: 'Which qualified supplier should we choose?',
    successDefinition: 'Best compliant value',
    options: [{ id: 'a', title: 'Supplier A' }, { id: 'b', title: 'Supplier B' }],
    generateOptions: false,
    constraints: ['legal'],
    stakeholderIds: ['stakeholder'],
    decisionAuthorityId: 'human',
    riskClassificationReference: 'moderate',
    deadline: new Date('2027-01-01'),
  },
  stakeholderId: 'stakeholder',
  criteria: [{ key: 'value', label: 'Value', unit: 'points', weight: 1, state: 'confirmed' as const }],
  vetoes: [],
  evidenceSnapshotHashes: ['evidence-hash'],
  policyVersion: 'policy:1',
  safetyCaseVersion: 'safety:1',
  routingPolicyVersion: 'router:1',
  reservationId: 'reservation',
  budget: { branches: 1, depth: 0, tokens: 10, moneyMinorUnits: 10, wallTimeMs: 1000, toolCalls: 0, concurrency: 1 },
  findings: [
    {
      id: 'fa', optionId: 'a', claimId: 'legal-a', kind: 'policy' as const, status: 'pass' as const,
      evidenceReferences: ['evidence-a'], verifierVersion: '1', rationale: 'Supplier A is eligible',
    },
    {
      id: 'fb', optionId: 'b', claimId: 'legal-b', kind: 'policy' as const, status: 'pass' as const,
      evidenceReferences: ['evidence-b'], verifierVersion: '1', rationale: 'Supplier B is eligible',
    },
  ],
  scores: [
    { optionId: 'a', criterionKey: 'value', value: 80, unit: 'points', normalizedUtility: 0.8, weight: 1, rubricVersion: '1' },
    { optionId: 'b', criterionKey: 'value', value: 60, unit: 'points', normalizedUtility: 0.6, weight: 1, rubricVersion: '1' },
  ],
  assumptions: ['Evidence remains current'],
  limitations: ['The platform does not make the human decision'],
};

describe('safe deliberation journey', () => {
  it('freezes inputs, completes bounded planning/evaluation and publishes a cited human-authority brief', () => {
    const result = new DecisionLaboratory(clock).run(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scenarioTree.state).toBe('completed');
    expect(result.value.evaluation.state).toBe('completed');
    expect(result.value.brief.state).toBe('published');
    expect(result.value.brief.content.paretoOptions).toEqual(['a']);
    expect(result.value.deliberation.state).toBe('review');
    expect(result.value.deliberation.recordedDecision).toBeUndefined();
  });

  it('returns a typed abstention before planning when material evidence is missing', () => {
    const result = new DecisionLaboratory(clock).run({ ...base, evidenceSnapshotHashes: [] });
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'ABSTAINED',
        message: 'Material evidence is missing',
        details: { unblock: 'Provide provenance-bearing evidence' },
      },
    });
  });
});
