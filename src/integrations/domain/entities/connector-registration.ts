import { AggregateRoot, type Clock, type Result, invariant } from '../../../shared/domain/index.js';

export type ConnectorTransport = 'stdio' | 'streamable-http';
export type CapabilityClass = 'read' | 'write';

export interface DiscoveredCapability {
  readonly name: string;
  readonly schemaHash: string;
  readonly capabilityClass: CapabilityClass;
}

export interface ApprovedCapability extends DiscoveredCapability {
  readonly approvedBy: string;
  readonly approvedAt: Date;
}

export class ConnectorRegistration extends AggregateRoot {
  public state: 'registered' | 'healthy' | 'quarantined' = 'registered';
  private readonly discovered = new Map<string, DiscoveredCapability>();
  private readonly approved = new Map<string, ApprovedCapability>();

  private constructor(
    id: string,
    tenantId: string,
    now: Date,
    readonly endpointIdentity: string,
    readonly transport: ConnectorTransport,
    readonly credentialReference: string,
    readonly allowedHosts: ReadonlySet<string>,
  ) {
    super(id, tenantId, 0, now, now);
  }

  static register(input: {
    id: string;
    tenantId: string;
    endpointIdentity: string;
    transport: ConnectorTransport;
    credentialReference: string;
    allowedHosts: readonly string[];
  }, clock: Clock): Result<ConnectorRegistration> {
    if (input.endpointIdentity.length === 0 || input.credentialReference.length === 0 || input.credentialReference.includes('secret=')) {
      return { ok: false, error: invariant('Pinned endpoint identity and opaque credential reference are required') };
    }
    return {
      ok: true,
      value: new ConnectorRegistration(
        input.id,
        input.tenantId,
        clock.now(),
        input.endpointIdentity,
        input.transport,
        input.credentialReference,
        new Set(input.allowedHosts),
      ),
    };
  }

  discover(capability: DiscoveredCapability): Result<ConnectorRegistration> {
    if (this.state === 'quarantined') return { ok: false, error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Connector quarantined' } };
    const approved = this.approved.get(capability.name);
    if (approved !== undefined && approved.schemaHash !== capability.schemaHash) {
      this.approved.delete(capability.name);
    }
    this.discovered.set(capability.name, Object.freeze({ ...capability }));
    return { ok: true, value: this };
  }

  approve(name: string, schemaHash: string, approverId: string, now: Date): Result<ConnectorRegistration> {
    const capability = this.discovered.get(name);
    if (capability === undefined || capability.schemaHash !== schemaHash) {
      return { ok: false, error: invariant('Approval must bind the discovered schema hash') };
    }
    this.approved.set(name, Object.freeze({ ...capability, approvedBy: approverId, approvedAt: now }));
    this.state = 'healthy';
    return { ok: true, value: this };
  }

  authorizeCapability(name: string, schemaHash: string, capabilityClass: CapabilityClass): Result<ApprovedCapability> {
    if (this.state !== 'healthy') return { ok: false, error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Connector unavailable' } };
    const approved = this.approved.get(name);
    if (approved === undefined || approved.schemaHash !== schemaHash || approved.capabilityClass !== capabilityClass) {
      return { ok: false, error: { code: 'PERMISSION_DENIED', message: 'Capability is not approved for this schema/class' } };
    }
    return { ok: true, value: approved };
  }

  permitsHost(host: string): boolean {
    return this.state === 'healthy' && this.allowedHosts.has(host);
  }

  quarantine(): void {
    this.state = 'quarantined';
  }
}
