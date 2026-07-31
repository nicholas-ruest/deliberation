import { AggregateRoot, type Clock, type EventFactory, type Result, invariant } from '../../../shared/domain/index.js';

export type TenantState = 'draft' | 'active' | 'suspended' | 'deletion-pending';

export interface IdentityConfiguration {
  readonly provider: 'oidc' | 'saml';
  readonly issuer: string;
  readonly breakGlassAdministratorIds: readonly string[];
}

export class Tenant extends AggregateRoot {
  private constructor(
    id: string,
    tenantId: string,
    version: number,
    createdAt: Date,
    updatedAt: Date,
    readonly legalName: string,
    public displayName: string,
    public state: TenantState,
    public region?: string,
    public identityConfiguration?: IdentityConfiguration,
    public encryptionKeyReference?: string,
  ) {
    super(id, tenantId, version, createdAt, updatedAt);
  }

  static create(id: string, legalName: string, displayName: string, clock: Clock): Tenant {
    const now = clock.now();
    return new Tenant(id, id, 0, now, now, legalName, displayName, 'draft');
  }

  configure(
    region: string,
    identityConfiguration: IdentityConfiguration,
    encryptionKeyReference: string,
    clock: Clock,
  ): Result<Tenant> {
    if (this.state !== 'draft') return { ok: false, error: invariant('Identity and region lock after activation') };
    if (identityConfiguration.breakGlassAdministratorIds.length === 0) {
      return { ok: false, error: invariant('At least one break-glass administrator is required') };
    }
    this.region = region;
    this.identityConfiguration = identityConfiguration;
    this.encryptionKeyReference = encryptionKeyReference;
    this.updatedAt = clock.now();
    return { ok: true, value: this };
  }

  activate(events: EventFactory, actorId: string, correlationId: string): Result<Tenant> {
    if (this.state !== 'draft' || this.region === undefined || this.identityConfiguration === undefined || this.encryptionKeyReference === undefined) {
      return { ok: false, error: invariant('Configured region, identity, and key are required for activation') };
    }
    this.state = 'active';
    this.raise(events.create('TenantActivated', this.eventContext(actorId, correlationId), { region: this.region }));
    return { ok: true, value: this };
  }

  suspend(events: EventFactory, actorId: string, correlationId: string, reason: string): Result<Tenant> {
    if (this.state !== 'active') return { ok: false, error: invariant('Only active tenants can be suspended') };
    this.state = 'suspended';
    this.raise(events.create('TenantSuspended', this.eventContext(actorId, correlationId), { reason }));
    return { ok: true, value: this };
  }

  requestDeletion(): Result<Tenant> {
    if (this.state !== 'suspended') return { ok: false, error: invariant('Governed deletion requires suspension first') };
    this.state = 'deletion-pending';
    return { ok: true, value: this };
  }

  private eventContext(actorId: string, correlationId: string) {
    return {
      tenantId: this.tenantId,
      aggregateType: 'Tenant',
      aggregateId: this.id,
      aggregateVersion: this.version + 1,
      actorId,
      correlationId,
      purpose: 'tenant-administration',
    };
  }
}
