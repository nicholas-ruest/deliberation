import type { Clock } from '../../shared/domain/clock.js';
import type { Result } from '../../shared/domain/result.js';
import { ConnectorRegistration } from '../domain/entities/connector-registration.js';
import type { FederatedMcpDiscoveryPort } from '../domain/repositories/federated-mcp-discovery.js';

/**
 * Operator-controlled facts about a federated server. None of this comes from the federation
 * layer: the credential stays a secrets-manager reference, the egress allowlist is configured
 * here, and `expectedEndpointIdentity` is the pin a discovered server must match.
 */
export interface FederatedServerProvisioning {
  readonly connectorId: string;
  readonly tenantId: string;
  readonly expectedEndpointIdentity: string;
  readonly credentialReference: string;
  readonly allowedHosts: readonly string[];
}

export interface FederatedCatalog {
  readonly registered: readonly ConnectorRegistration[];
  readonly skippedServerIds: readonly string[];
}

/**
 * Turns federation discovery into ordinary `ConnectorRegistration` aggregates with their
 * capabilities recorded as *discovered*. Nothing here approves anything and nothing here becomes
 * callable: `ConnectorGateway.invoke` still requires a separate human approval binding the schema
 * hash (ADR-008). A server the operator has not provisioned, or whose endpoint identity does not
 * match the pin, is skipped rather than registered.
 */
export async function registerDiscoveredFederation(
  discovery: FederatedMcpDiscoveryPort,
  provisioningFor: (serverId: string) => FederatedServerProvisioning | undefined,
  clock: Clock,
): Promise<Result<FederatedCatalog>> {
  const servers = await discovery.listServers();
  if (!servers.ok) return servers;

  const registered: ConnectorRegistration[] = [];
  const skippedServerIds: string[] = [];
  for (const server of servers.value) {
    const provisioning = provisioningFor(server.serverId);
    if (provisioning === undefined || provisioning.expectedEndpointIdentity !== server.endpointIdentity) {
      skippedServerIds.push(server.serverId);
      continue;
    }
    const registration = ConnectorRegistration.register({
      id: provisioning.connectorId,
      tenantId: provisioning.tenantId,
      endpointIdentity: server.endpointIdentity,
      transport: server.transport,
      credentialReference: provisioning.credentialReference,
      allowedHosts: provisioning.allowedHosts,
    }, clock);
    if (!registration.ok) return registration;
    for (const capability of server.capabilities) {
      const discovered = registration.value.discover(capability);
      if (!discovered.ok) return discovered;
    }
    registered.push(registration.value);
  }
  return { ok: true, value: { registered, skippedServerIds } };
}
