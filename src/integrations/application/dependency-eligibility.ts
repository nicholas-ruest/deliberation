import type { Result } from '../../shared/domain/result.js';
import { createHash } from 'node:crypto';
import type { ProductionDependency } from '../domain/entities/production-dependency.js';

export interface DependencyUse {
  readonly dependencyId: string;
  readonly immutableVersion: string;
  readonly region: string;
  readonly dataClass: string;
  readonly purpose: string;
  readonly driftFingerprint: string;
}

export interface DependencyEligibilityReceipt {
  readonly dependencyId: string;
  readonly catalogVersion: number;
  readonly qualificationDigest: string;
  readonly expiresAt: Date;
}

export interface DependencyEligibilityPort {
  authorize(use: DependencyUse): Result<DependencyEligibilityReceipt>;
  generation(dependencyId: string): number;
}

export const denyUnqualifiedDependencies: DependencyEligibilityPort = {
  authorize: () => ({ ok: false, error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Production dependency catalog is required' } }),
  generation: () => 0,
};

export const allowTestDependencies: DependencyEligibilityPort = {
  authorize: (use) => ({ ok: true, value: {
    dependencyId: use.dependencyId, catalogVersion: 0, qualificationDigest: 'test-only',
    expiresAt: new Date(8_640_000_000_000_000),
  } }),
  generation: () => 0,
};

export class VersionedDependencyCatalog implements DependencyEligibilityPort {
  private readonly generations = new Map<string, number>();
  constructor(private readonly dependencies: ReadonlyMap<string, ProductionDependency>, private readonly now: () => Date) {}

  authorize(use: DependencyUse): Result<DependencyEligibilityReceipt> {
    const dependency = this.dependencies.get(use.dependencyId);
    if (dependency === undefined || dependency.qualification.immutableProviderVersion !== use.immutableVersion
      || dependency.qualification.purpose !== use.purpose) {
      return { ok: false, error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Unknown or mismatched dependency qualification' } };
    }
    const decision = dependency.decide(use.region, use.dataClass, this.now(), use.driftFingerprint);
    if (!decision.ok) {
      this.generations.set(use.dependencyId, this.generation(use.dependencyId) + 1);
      return decision;
    }
    return { ok: true, value: {
      dependencyId: use.dependencyId,
      catalogVersion: decision.value.version,
      qualificationDigest: createHash('sha256').update(JSON.stringify({
        id: decision.value.id, version: decision.value.version, fixtureHash: decision.value.fixtureHash,
        reviewedAt: decision.value.reviewedAt.toISOString(), expiresAt: decision.value.expiresAt.toISOString(),
      })).digest('hex'),
      expiresAt: new Date(decision.value.expiresAt),
    } };
  }

  generation(dependencyId: string): number {
    return this.generations.get(dependencyId) ?? 0;
  }
}
