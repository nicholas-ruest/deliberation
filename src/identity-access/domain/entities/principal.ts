import { AggregateRoot, type Clock, type Result, invariant } from '../../../shared/domain/index.js';

export type PrincipalState = 'active' | 'disabled';

export interface Membership {
  readonly role: string;
  readonly grantedAt: Date;
}

export class Principal extends AggregateRoot {
  readonly memberships = new Map<string, Membership>();
  public state: PrincipalState = 'active';
  public sessionEpoch = 0;

  private constructor(
    id: string,
    tenantId: string,
    version: number,
    createdAt: Date,
    updatedAt: Date,
    readonly provider: string,
    readonly externalSubject: string,
  ) {
    super(id, tenantId, version, createdAt, updatedAt);
  }

  static provision(
    id: string,
    tenantId: string,
    provider: string,
    externalSubject: string,
    clock: Clock,
  ): Principal {
    const now = clock.now();
    return new Principal(id, tenantId, 0, now, now, provider, externalSubject);
  }

  grant(role: string, clock: Clock): Result<Principal> {
    if (this.state !== 'active') return { ok: false, error: invariant('Disabled principals cannot receive roles') };
    this.memberships.set(role, { role, grantedAt: clock.now() });
    this.sessionEpoch += 1;
    this.updatedAt = clock.now();
    return { ok: true, value: this };
  }

  revoke(role: string, remainingTenantOwners: number, clock: Clock): Result<Principal> {
    if (role === 'tenant-owner' && this.memberships.has(role) && remainingTenantOwners < 1) {
      return { ok: false, error: invariant('The final tenant owner cannot be removed') };
    }
    this.memberships.delete(role);
    this.sessionEpoch += 1;
    this.updatedAt = clock.now();
    return { ok: true, value: this };
  }

  disable(clock: Clock): void {
    this.state = 'disabled';
    this.sessionEpoch += 1;
    this.updatedAt = clock.now();
  }

  revokeSessions(clock: Clock): number {
    this.sessionEpoch += 1;
    this.updatedAt = clock.now();
    return this.sessionEpoch;
  }
}
