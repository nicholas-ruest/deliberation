import type { Result } from '../../../shared/domain/result.js';

export type DependencyState = 'draft' | 'qualifying' | 'eligible' | 'quarantined' | 'expired';

/**
 * ADR-042: the second of two paths to `eligible` for a dependency with a standing, named
 * finding against it (the first being the finding simply clearing upstream). Recording one here
 * does not itself change `ProductionDependency.state` — `markEligible` still requires
 * `evidencePassed`, and the automated enforcement gate (`scripts/check-dependency-qualification.ts`,
 * ADR-041) is what actually treats a currently-audit-flagged dependency as blocked unless a valid,
 * unexpired acceptance for it is on file in that script's own registry. This type is the
 * self-documenting, domain-level record of that decision for anyone constructing or reading a real
 * qualification; the script's registry is the enforced source of truth and must be kept in sync by
 * hand, the same discipline `scripts/check-licenses.ts`'s `missingLicenseExceptions` already uses.
 */
export interface RiskAcceptance {
  /** The specific advisory/CVE identifiers being accepted, never a blanket "audit findings". */
  readonly acceptedAdvisories: readonly string[];
  /** Why the accepted advisories are not exploitable in this platform's actual usage. */
  readonly rationale: string;
  readonly requestedBy: string;
  readonly approvedBy: string;
  /** Where this acceptance is documented outside the source tree (ADR-042 item 2). */
  readonly disclosureRef: string;
  /** Forces periodic re-review; must not exceed the qualification's own `expiresAt`. */
  readonly expiresAt: Date;
}

export interface DependencyQualification {
  readonly id: string;
  readonly version: number;
  readonly immutableProviderVersion: string;
  readonly owner: string;
  readonly purpose: string;
  readonly dataClasses: readonly string[];
  readonly regions: readonly string[];
  readonly retentionDays: number;
  readonly permitsTraining: boolean;
  readonly fixtureHash: string;
  readonly killSwitchId: string;
  readonly exitPlan: string;
  readonly reviewedAt: Date;
  readonly expiresAt: Date;
  readonly driftFingerprint: string;
  readonly riskAcceptance?: RiskAcceptance;
}

export class ProductionDependency {
  public state: DependencyState = 'draft';
  constructor(readonly qualification: DependencyQualification) {
    if (!qualification.id || !Number.isSafeInteger(qualification.version) || qualification.version < 1
      || !qualification.owner || !qualification.purpose || !qualification.fixtureHash || !qualification.driftFingerprint
      || !qualification.immutableProviderVersion || /(?:^|[-_.])(latest|stable|default)(?:$|[-_.])/i.test(qualification.immutableProviderVersion)
      || qualification.regions.length === 0 || qualification.dataClasses.length === 0
      || !Number.isFinite(qualification.retentionDays) || qualification.retentionDays < 0
      || !qualification.exitPlan || !qualification.killSwitchId
      || !Number.isFinite(qualification.reviewedAt.getTime()) || !Number.isFinite(qualification.expiresAt.getTime())
      || qualification.reviewedAt >= qualification.expiresAt) {
      throw new Error('Production dependency qualification is incomplete or mutable');
    }
    const acceptance = qualification.riskAcceptance;
    if (acceptance !== undefined) {
      if (acceptance.acceptedAdvisories.length === 0 || !acceptance.rationale || !acceptance.requestedBy
        || !acceptance.approvedBy || acceptance.requestedBy === acceptance.approvedBy || !acceptance.disclosureRef
        || !Number.isFinite(acceptance.expiresAt.getTime()) || acceptance.expiresAt > qualification.expiresAt) {
        throw new Error('Risk acceptance is incomplete, self-approved, or outlives its qualification');
      }
    }
  }
  startQualification(): void {
    if (this.state !== 'draft') throw new Error('Invalid qualification transition');
    this.state = 'qualifying';
  }
  markEligible(evidencePassed: boolean): void {
    if (this.state !== 'qualifying' || !evidencePassed) throw new Error('Qualification evidence required');
    this.state = 'eligible';
  }
  quarantine(): void { this.state = 'quarantined'; }
  decide(region: string, dataClass: string, now: Date, fingerprint: string): Result<DependencyQualification> {
    if (now >= this.qualification.expiresAt) this.state = 'expired';
    if (fingerprint !== this.qualification.driftFingerprint) this.state = 'quarantined';
    if (this.state !== 'eligible'
      || !this.qualification.regions.includes(region) || !this.qualification.dataClasses.includes(dataClass)) {
      return { ok: false, error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Dependency is not qualified for this use' } };
    }
    return { ok: true, value: this.qualification };
  }
}
