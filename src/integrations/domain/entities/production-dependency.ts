import type { Result } from '../../../shared/domain/result.js';

export type DependencyState = 'draft' | 'qualifying' | 'eligible' | 'quarantined' | 'expired';

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
