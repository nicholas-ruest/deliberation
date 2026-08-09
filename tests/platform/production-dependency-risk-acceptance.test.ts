import { describe, expect, it } from 'vitest';
import { ProductionDependency, type DependencyQualification } from '../../src/integrations/domain/entities/production-dependency.js';

function baseQualification(overrides: Partial<DependencyQualification> = {}): DependencyQualification {
  return {
    id: 'example-dependency', version: 1, immutableProviderVersion: 'example@1.2.3', owner: 'platform-team',
    purpose: 'testing', dataClasses: ['internal'], regions: ['eu-1'], retentionDays: 0, permitsTraining: false,
    fixtureHash: 'fixture-hash', killSwitchId: 'example-dependency', exitPlan: 'remove the binding',
    reviewedAt: new Date('2026-08-09T00:00:00.000Z'), expiresAt: new Date('2027-08-09T00:00:00.000Z'),
    driftFingerprint: 'example@1.2.3',
    ...overrides,
  };
}

describe('ProductionDependency risk acceptance (ADR-042)', () => {
  it('constructs fine with no risk acceptance at all — the ordinary case', () => {
    expect(() => new ProductionDependency(baseQualification())).not.toThrow();
  });

  it('accepts a well-formed risk acceptance', () => {
    const qualification = baseQualification({
      riskAcceptance: {
        acceptedAdvisories: ['GHSA-example-1234'],
        rationale: 'The vulnerable code path is never invoked by this adapter.',
        requestedBy: 'alice',
        approvedBy: 'bob',
        disclosureRef: 'docs/implementation/prompt-035-040.md',
        expiresAt: new Date('2026-12-01T00:00:00.000Z'),
      },
    });
    expect(() => new ProductionDependency(qualification)).not.toThrow();
  });

  it('rejects a self-approved risk acceptance', () => {
    const qualification = baseQualification({
      riskAcceptance: {
        acceptedAdvisories: ['GHSA-example-1234'], rationale: 'not exploitable here',
        requestedBy: 'alice', approvedBy: 'alice',
        disclosureRef: 'docs/implementation/prompt-035-040.md', expiresAt: new Date('2026-12-01T00:00:00.000Z'),
      },
    });
    expect(() => new ProductionDependency(qualification)).toThrow(/self-approved/);
  });

  it('rejects a risk acceptance that outlives its own qualification', () => {
    const qualification = baseQualification({
      riskAcceptance: {
        acceptedAdvisories: ['GHSA-example-1234'], rationale: 'not exploitable here',
        requestedBy: 'alice', approvedBy: 'bob',
        disclosureRef: 'docs/implementation/prompt-035-040.md',
        expiresAt: new Date('2028-01-01T00:00:00.000Z'), // after the qualification's own 2027-08-09 expiresAt
      },
    });
    expect(() => new ProductionDependency(qualification)).toThrow(/outlives/);
  });

  it('rejects a risk acceptance with no accepted advisories named', () => {
    const qualification = baseQualification({
      riskAcceptance: {
        acceptedAdvisories: [], rationale: 'not exploitable here',
        requestedBy: 'alice', approvedBy: 'bob',
        disclosureRef: 'docs/implementation/prompt-035-040.md', expiresAt: new Date('2026-12-01T00:00:00.000Z'),
      },
    });
    expect(() => new ProductionDependency(qualification)).toThrow();
  });

  it('rejects a risk acceptance with no disclosure reference', () => {
    const qualification = baseQualification({
      riskAcceptance: {
        acceptedAdvisories: ['GHSA-example-1234'], rationale: 'not exploitable here',
        requestedBy: 'alice', approvedBy: 'bob',
        disclosureRef: '', expiresAt: new Date('2026-12-01T00:00:00.000Z'),
      },
    });
    expect(() => new ProductionDependency(qualification)).toThrow();
  });
});
