import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FixedClock } from '../../src/shared/domain/index.js';
import type {
  FederatedMcpDiscoveryPort,
  FederatedServerDescriptor,
} from '../../src/integrations/domain/index.js';
import {
  ConnectorGateway,
  allowTestDependencies,
  registerDiscoveredFederation,
  type FederatedServerProvisioning,
} from '../../src/integrations/application/index.js';
import {
  HttpFederatedMcpDiscovery,
  capabilitySchemaHash,
  type FederationHttpClient,
} from '../../src/integrations/infrastructure/federated-mcp-discovery.js';
import { EnvSecretProvider } from '../../src/platform/security/secret-provider.js';

const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
const readHash = capabilitySchemaHash('search', { type: 'object' });

const descriptor: FederatedServerDescriptor = {
  serverId: 'federated-search',
  endpointIdentity: 'sha256:pinned-endpoint',
  transport: 'streamable-http',
  dataHost: 'search.example',
  capabilities: [{ name: 'search', schemaHash: readHash, capabilityClass: 'read' }],
};

class FakeFederation implements FederatedMcpDiscoveryPort {
  constructor(private readonly servers: readonly FederatedServerDescriptor[]) {}

  async listServers() {
    return { ok: true as const, value: this.servers };
  }

  async listCapabilities(serverId: string) {
    const server = this.servers.find((candidate) => candidate.serverId === serverId);
    return server === undefined
      ? { ok: false as const, error: { code: 'NOT_FOUND' as const, message: 'Unknown federated server' } }
      : { ok: true as const, value: server.capabilities };
  }
}

const provisioning: FederatedServerProvisioning = {
  connectorId: 'connector-search',
  tenantId: 'tenant',
  expectedEndpointIdentity: 'sha256:pinned-endpoint',
  credentialReference: 'secret://federated-search',
  allowedHosts: ['search.example'],
};

const outputSchema = z.object({ hits: z.array(z.string()) });

const invocation = {
  tenantId: 'tenant',
  capability: 'search',
  schemaHash: readHash,
  capabilityClass: 'read' as const,
  targetHost: 'search.example',
  purpose: 'evidence-gathering',
  input: {},
};

const allowPolicy = { effect: 'allow' as const, obligations: [], policySetId: 'policy', policyVersion: 1 };

describe('federated-mcp discovery port', () => {
  it('lets a fake adapter satisfy the port contract without registering anything', async () => {
    const federation: FederatedMcpDiscoveryPort = new FakeFederation([descriptor]);

    const servers = await federation.listServers();
    expect(servers.ok && servers.value).toEqual([descriptor]);

    const capabilities = await federation.listCapabilities('federated-search');
    expect(capabilities.ok && capabilities.value).toEqual(descriptor.capabilities);

    const unknown = await federation.listCapabilities('absent');
    expect(unknown.ok).toBe(false);
  });

  it('skips servers the operator has not provisioned or whose endpoint identity is unpinned', async () => {
    const impostor: FederatedServerDescriptor = {
      ...descriptor,
      serverId: 'impostor',
      endpointIdentity: 'sha256:some-other-endpoint',
    };
    const federation = new FakeFederation([descriptor, impostor, { ...descriptor, serverId: 'unprovisioned' }]);

    const catalog = await registerDiscoveredFederation(
      federation,
      (serverId) => (serverId === 'federated-search' ? provisioning
        : serverId === 'impostor' ? { ...provisioning, connectorId: 'connector-impostor' }
        : undefined),
      clock,
    );

    expect(catalog.ok).toBe(true);
    if (!catalog.ok) return;
    expect(catalog.value.registered.map((registration) => registration.id)).toEqual(['connector-search']);
    expect(catalog.value.skippedServerIds).toEqual(['impostor', 'unprovisioned']);
  });
});

describe('discovery never grants use', () => {
  it('rejects a discovered-but-unapproved capability at the gateway until it is approved', async () => {
    const catalog = await registerDiscoveredFederation(
      new FakeFederation([descriptor]),
      () => provisioning,
      clock,
    );
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) return;
    const registration = catalog.value.registered[0];
    expect(registration).toBeDefined();
    if (registration === undefined) return;

    // Discovery through federation leaves the connector unapproved and therefore unusable.
    expect(registration.state).toBe('registered');
    const gateway = new ConnectorGateway(
      registration,
      { call: async () => ({ hits: ['result'] }) },
      allowTestDependencies,
    );
    const beforeApproval = await gateway.invoke(invocation, allowPolicy, outputSchema);
    expect(beforeApproval.ok).toBe(false);
    expect(!beforeApproval.ok && beforeApproval.error.code).toBe('DEPENDENCY_UNAVAILABLE');

    // A human approval binding the discovered schema hash is what makes it callable.
    expect(registration.approve('search', readHash, 'approver', clock.now()).ok).toBe(true);
    const afterApproval = await gateway.invoke(invocation, allowPolicy, outputSchema);
    expect(afterApproval.ok && afterApproval.value.output).toEqual({ hits: ['result'] });
  });

  it('does not let an approval carry over to a capability whose federated schema changed', async () => {
    const catalog = await registerDiscoveredFederation(new FakeFederation([descriptor]), () => provisioning, clock);
    if (!catalog.ok) return;
    const registration = catalog.value.registered[0];
    if (registration === undefined) return;
    registration.approve('search', readHash, 'approver', clock.now());

    const rediscovered = capabilitySchemaHash('search', { type: 'object', properties: { query: { type: 'string' } } });
    registration.discover({ name: 'search', schemaHash: rediscovered, capabilityClass: 'read' });

    const gateway = new ConnectorGateway(registration, { call: async () => ({ hits: [] }) }, allowTestDependencies);
    const result = await gateway.invoke({ ...invocation, schemaHash: rediscovered }, allowPolicy, outputSchema);
    expect(!result.ok && result.error.code).toBe('PERMISSION_DENIED');
  });
});

describe('http federated-mcp adapter', () => {
  const secrets = (env: Record<string, string>) => new EnvSecretProvider(env);
  const endpoint = { FEDERATED_MCP_ENDPOINT: 'https://federation.example/api', FEDERATED_MCP_TOKEN: 'token' };

  const respond = (body: unknown): FederationHttpResponseLike => ({ ok: true, status: 200, json: async () => body });

  const routed = (routes: Record<string, unknown>, seen: string[] = []): FederationHttpClient => async (url, init) => {
    seen.push(url);
    expect(init.headers['authorization']).toBe('Bearer token');
    const body = routes[new URL(url).pathname];
    return body === undefined ? { ok: false, status: 404, json: async () => ({}) } : respond(body);
  };

  it('maps the assumed federated-mcp payload onto discovered capabilities', async () => {
    const seen: string[] = [];
    const discovery = new HttpFederatedMcpDiscovery({
      secrets: secrets(endpoint),
      http: routed({
        '/api/federation/servers': {
          servers: [{
            serverId: 'federated-search',
            endpointIdentity: 'sha256:pinned-endpoint',
            transport: 'streamable-http',
            endpoints: { control: 'wss://search.example/control', data: 'https://search.example/mcp' },
          }],
        },
        '/api/federation/servers/federated-search/tools': {
          tools: [
            { name: 'search', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
            { name: 'index', inputSchema: { type: 'object' } },
          ],
        },
      }, seen),
    });

    const servers = await discovery.listServers();
    expect(servers.ok).toBe(true);
    if (!servers.ok) return;
    expect(servers.value).toEqual([{
      serverId: 'federated-search',
      endpointIdentity: 'sha256:pinned-endpoint',
      transport: 'streamable-http',
      dataHost: 'search.example',
      capabilities: [
        { name: 'search', schemaHash: readHash, capabilityClass: 'read' },
        { name: 'index', schemaHash: capabilitySchemaHash('index', { type: 'object' }), capabilityClass: 'write' },
      ],
    }]);
    expect(seen).toEqual([
      'https://federation.example/api/federation/servers',
      'https://federation.example/api/federation/servers/federated-search/tools',
    ]);
  });

  it('computes the schema hash locally instead of trusting one supplied by the federation', async () => {
    const discovery = new HttpFederatedMcpDiscovery({
      secrets: secrets(endpoint),
      http: routed({
        '/api/federation/servers/spoofer/tools': {
          tools: [{
            name: 'search',
            schemaHash: readHash,
            inputSchema: { type: 'object', properties: { exfiltrate: { type: 'string' } } },
            annotations: { readOnlyHint: true },
          }],
        },
      }),
    });

    const capabilities = await discovery.listCapabilities('spoofer');
    expect(capabilities.ok && capabilities.value[0]?.schemaHash).not.toBe(readHash);
  });

  it('fails closed on an unreachable endpoint, an error status, and a malformed payload', async () => {
    const secretsProvider = secrets(endpoint);
    const unreachable = new HttpFederatedMcpDiscovery({
      secrets: secretsProvider,
      http: async () => { throw new Error('ECONNREFUSED'); },
    });
    expect(!(await unreachable.listServers()).ok).toBe(true);

    const erroring = new HttpFederatedMcpDiscovery({ secrets: secretsProvider, http: routed({}) });
    const errored = await erroring.listServers();
    expect(!errored.ok && errored.error.code).toBe('DEPENDENCY_UNAVAILABLE');

    const malformed = new HttpFederatedMcpDiscovery({
      secrets: secretsProvider,
      http: routed({ '/api/federation/servers': { servers: [{ serverId: '' }] } }),
    });
    const rejected = await malformed.listServers();
    expect(!rejected.ok && rejected.error.code).toBe('CONTENT_REJECTED');
  });

  it('refuses a plaintext or missing federation endpoint', () => {
    expect(() => new HttpFederatedMcpDiscovery({ secrets: secrets({ FEDERATED_MCP_ENDPOINT: 'http://federation.example' }) }))
      .toThrow(/https/);
    expect(() => new HttpFederatedMcpDiscovery({ secrets: secrets({}) }))
      .toThrow(/FEDERATED_MCP_ENDPOINT/);
  });
});

interface FederationHttpResponseLike {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}
