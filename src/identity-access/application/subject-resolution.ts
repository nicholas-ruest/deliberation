import type { Principal } from '../domain/entities/principal.js';
import type { Tenant } from '../domain/entities/tenant.js';
import type { Result } from '../../shared/domain/result.js';

export interface Subject {
  readonly tenantId: string;
  readonly principalId: string;
  readonly sessionEpoch: number;
  readonly roles: readonly string[];
  readonly resolvedAt: Date;
}

export interface SubjectStore {
  tenant(tenantId: string): Promise<Tenant | undefined>;
  principal(tenantId: string, principalId: string): Promise<Principal | undefined>;
}

export class SubjectResolver {
  private readonly cache = new Map<string, { subject: Subject; expiresAt: number }>();

  constructor(
    private readonly store: SubjectStore,
    private readonly ttlMs = 30_000,
  ) {}

  async resolve(tenantId: string, principalId: string, claimedEpoch: number, now: Date): Promise<Result<Subject>> {
    const key = `${tenantId}:${principalId}`;
    const cached = this.cache.get(key);
    if (cached !== undefined && cached.expiresAt > now.getTime() && cached.subject.sessionEpoch === claimedEpoch) {
      return { ok: true, value: cached.subject };
    }
    const [tenant, principal] = await Promise.all([
      this.store.tenant(tenantId),
      this.store.principal(tenantId, principalId),
    ]);
    if (tenant?.state !== 'active' || principal?.state !== 'active' || principal.sessionEpoch !== claimedEpoch) {
      return { ok: false, error: { code: 'PERMISSION_DENIED', message: 'Subject is not active in tenant scope' } };
    }
    const subject: Subject = {
      tenantId,
      principalId,
      sessionEpoch: principal.sessionEpoch,
      roles: [...principal.memberships.keys()],
      resolvedAt: now,
    };
    this.cache.set(key, { subject, expiresAt: now.getTime() + this.ttlMs });
    return { ok: true, value: subject };
  }

  revoke(tenantId: string, principalId: string): void {
    this.cache.delete(`${tenantId}:${principalId}`);
  }
}
