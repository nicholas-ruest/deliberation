import { bench, describe } from 'vitest';
import { CellPlacementGuard } from '../src/platform/runtime/index.js';
import { ProductionDependency } from '../src/integrations/domain/entities/index.js';
import { renderHumanAuthorityBrief } from '../src/web/index.js';

const assignments = new Map(Array.from({ length: 1_000 }, (_, index) => [
  `tenant-${index}`, { tenantId: `tenant-${index}`, cellId: 'eu-1a', region: 'eu-1' },
]));
const placement = new CellPlacementGuard(assignments);
const dependency = new ProductionDependency({
  id: 'model', version: 1, immutableProviderVersion: 'model-2026-07-31', owner: 'platform',
  purpose: 'generation', dataClasses: ['internal'], regions: ['eu-1'], retentionDays: 0,
  permitsTraining: false, fixtureHash: 'f', killSwitchId: 'model', exitPlan: 'revoke',
  reviewedAt: new Date('2026-01-01'), expiresAt: new Date('2027-01-01'), driftFingerprint: 'v1',
});
dependency.startQualification();
dependency.markEligible(true);
const brief = {
  title: 'Decision brief',
  claims: Array.from({ length: 100 }, (_, index) => ({
    text: `Claim ${index}`, epistemicClass: 'external-claim' as const,
    citations: [{ label: `Citation ${index}`, href: `https://evidence.example/${index}` }],
  })),
  dissent: ['One dissent'], assumptions: ['One assumption'], limitations: ['One limitation'],
};

describe('prompts 026-032 local policy hot paths', () => {
  bench('cell placement among 1000 tenants', () => placement.authorize('tenant-999', 'eu-1a', 'eu-1'));
  bench('qualified dependency decision', () => dependency.decide('eu-1', 'internal', new Date('2026-08-01'), 'v1'));
  bench('accessible 100-claim SSR', () => renderHumanAuthorityBrief(brief, 'csrf'));
});
