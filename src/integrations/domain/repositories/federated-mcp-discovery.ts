import type { Result } from '../../../shared/domain/result.js';
import type { ConnectorTransport, DiscoveredCapability } from '../entities/connector-registration.js';

/**
 * What a federation endpoint claims about one MCP server it knows about. Every field is an
 * assertion by a remote party, not a fact: `endpointIdentity` is checked against an
 * operator-pinned value before registration, and `dataHost` is advisory only — the egress
 * allowlist comes from operator configuration, never from this payload (ADR-008, ADR-037).
 */
export interface FederatedServerDescriptor {
  readonly serverId: string;
  readonly endpointIdentity: string;
  readonly transport: ConnectorTransport;
  readonly dataHost: string;
  readonly capabilities: readonly DiscoveredCapability[];
}

/**
 * Read-only view onto a federated-mcp instance. Every method returns data; none of them may
 * register, approve, or grant anything. Discovery through federation is exactly as unprivileged
 * as discovery against a single server already is.
 */
export interface FederatedMcpDiscoveryPort {
  listServers(): Promise<Result<readonly FederatedServerDescriptor[]>>;
  listCapabilities(serverId: string): Promise<Result<readonly DiscoveredCapability[]>>;
}
