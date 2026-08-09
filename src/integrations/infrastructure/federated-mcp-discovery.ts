import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Result } from '../../shared/domain/result.js';
import type { DiscoveredCapability } from '../domain/entities/connector-registration.js';
import type {
  FederatedMcpDiscoveryPort,
  FederatedServerDescriptor,
} from '../domain/repositories/federated-mcp-discovery.js';
import type { SecretProvider } from '../../platform/security/secret-provider.js';

/**
 * VERIFIED AGAINST A LIVE INSTANCE (ADR-046): federated-mcp exposes NO HTTP discovery surface.
 *
 * Verification performed 2026-08-09 against `github.com/ruvnet/federated-mcp` at commit
 * 486dc9c022a51bea0775e645e206336ee66212de (the repository HEAD, last touched 2024-11-26), run in
 * a throwaway container built from the upstream tree on `denoland/deno:1.40.2` — the base image
 * its own committed Dockerfile pins. Findings, from the source and from the running process:
 *
 *  - `src/apps/deno/server.ts` — the Dockerfile's entrypoint — serves a single handler that is
 *    literally `return new Response("AI Federation Network Online", { status: 200 })`. It does
 *    not read the request. Probing the live container confirmed it: `/`, `/federation/servers`,
 *    `/federation/servers/{id}/tools`, `/info`, `/capabilities`, `/mcp`, `/health` and an
 *    invented control path all return the same `200 text/plain` banner, under GET, POST, PUT,
 *    DELETE, OPTIONS and HEAD alike. There is no router, so there is no 404 either.
 *  - `FederationProxy` (`src/packages/proxy/federation.ts`) is imported only by the upstream
 *    tests and docs — never by any server entrypoint. Registering a server through it was
 *    exercised for real in the container: `getConnectedServers()` went from `[]` to
 *    `["probe-server-1"]`, and the HTTP surface did not change by one byte. Federation state is
 *    in-process only and is not projected onto HTTP at any path.
 *  - The only route tables in the tree belong to other deploy targets: the Cloudflare worker
 *    (`src/worker/index.ts`, `/info` + `/capabilities`, returning static `ServerInfo` booleans,
 *    not a server or tool list) and the Supabase edge functions (`src/packages/edge/server.ts`).
 *    Neither is federation discovery and neither is what the Dockerfile runs.
 *
 * Consequently ADR-046's fallback applies: HTTP federation discovery is NOT viable against the
 * current federated-mcp release. Embedding it as an in-process library is not viable either — it
 * is Deno-only (`.ts` extension imports, `Deno.serve`, an implicit-latest `deno.land/x/djwt`
 * import), its `package.json` declares no name/version/main/exports, and it is not published to
 * npm (registry returns 404). The supported path is therefore `StaticFederatedMcpDiscovery`
 * below: an operator-supplied, hand-maintained server list feeding the same
 * `registerDiscoveredFederation` flow, which ADR-037 already required to work that way.
 *
 * `HttpFederatedMcpDiscovery` is retained for a future federated-mcp release that grows a real
 * read-only discovery API, and is deliberately NOT wired to anything. Its paths and schemas below
 * match no released contract. Pointed at a real instance today it fails closed rather than
 * misreading the banner: the response is `200` but not JSON, so parsing yields `undefined`, the
 * zod schema rejects it, and the adapter returns `CONTENT_REJECTED` — asserted for real against
 * the live container in `tests/integrations/federated-mcp-live-contract.test.ts`.
 *
 * Two properties are deliberately NOT taken from the wire, because a discovered server must not
 * be able to widen its own trust: the schema hash is computed here over canonical JSON rather
 * than accepted from the response, and no egress host is authorized here — `dataHost` is reported
 * for operator review only.
 */
const SERVERS_PATH = '/federation/servers';
const toolsPath = (serverId: string): string =>
  `${SERVERS_PATH}/${encodeURIComponent(serverId)}/tools`;

const serversSchema = z.object({
  servers: z.array(z.object({
    serverId: z.string().min(1),
    endpointIdentity: z.string().min(1),
    transport: z.enum(['stdio', 'streamable-http']),
    endpoints: z.object({ data: z.string().min(1) }),
  })),
});

const toolsSchema = z.object({
  tools: z.array(z.object({
    name: z.string().min(1),
    inputSchema: z.unknown(),
    annotations: z.object({ readOnlyHint: z.boolean().optional() }).optional(),
  })),
});

export interface FederationHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type FederationHttpClient = (
  url: string,
  init: { readonly method: 'GET'; readonly headers: Readonly<Record<string, string>>; readonly signal: AbortSignal },
) => Promise<FederationHttpResponse>;

export interface HttpFederatedMcpDiscoveryOptions {
  readonly secrets: SecretProvider;
  readonly http?: FederationHttpClient;
  readonly timeoutMs?: number;
}

export class HttpFederatedMcpDiscovery implements FederatedMcpDiscoveryPort {
  private readonly baseUrl: URL;
  private readonly token: string | undefined;
  private readonly http: FederationHttpClient;
  private readonly timeoutMs: number;

  constructor(options: HttpFederatedMcpDiscoveryOptions) {
    this.baseUrl = new URL(options.secrets.require('FEDERATED_MCP_ENDPOINT'));
    if (this.baseUrl.protocol !== 'https:') {
      throw new Error('FEDERATED_MCP_ENDPOINT must be an https URL');
    }
    this.token = options.secrets.optional('FEDERATED_MCP_TOKEN');
    this.http = options.http ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  async listServers(): Promise<Result<readonly FederatedServerDescriptor[]>> {
    const payload = await this.get(SERVERS_PATH, serversSchema);
    if (!payload.ok) return payload;
    const descriptors: FederatedServerDescriptor[] = [];
    for (const server of payload.value.servers) {
      const capabilities = await this.listCapabilities(server.serverId);
      if (!capabilities.ok) return capabilities;
      const dataHost = parseHost(server.endpoints.data);
      if (dataHost === undefined) {
        return { ok: false, error: { code: 'CONTENT_REJECTED', message: 'Federated server reported an unusable data endpoint' } };
      }
      descriptors.push({
        serverId: server.serverId,
        endpointIdentity: server.endpointIdentity,
        transport: server.transport,
        dataHost,
        capabilities: capabilities.value,
      });
    }
    return { ok: true, value: descriptors };
  }

  async listCapabilities(serverId: string): Promise<Result<readonly DiscoveredCapability[]>> {
    const payload = await this.get(toolsPath(serverId), toolsSchema);
    if (!payload.ok) return payload;
    return {
      ok: true,
      value: payload.value.tools.map((tool) => ({
        name: tool.name,
        schemaHash: capabilitySchemaHash(tool.name, tool.inputSchema),
        // A tool that does not positively assert read-only is treated as a write, which forces
        // the gateway's human-review obligation rather than silently relaxing it.
        capabilityClass: tool.annotations?.readOnlyHint === true ? 'read' : 'write',
      })),
    };
  }

  private async get<T>(path: string, schema: z.ZodType<T>): Promise<Result<T>> {
    const url = new URL(`${this.baseUrl.pathname.replace(/\/$/, '')}${path}`, this.baseUrl);
    let response: FederationHttpResponse;
    try {
      response = await this.http(url.toString(), {
        method: 'GET',
        headers: this.token === undefined ? {} : { authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      return { ok: false, error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Federation endpoint unreachable', retryable: true } };
    }
    if (!response.ok) {
      return { ok: false, error: { code: 'DEPENDENCY_UNAVAILABLE', message: `Federation endpoint returned ${response.status}`, retryable: true } };
    }
    const parsed = schema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) {
      return { ok: false, error: { code: 'CONTENT_REJECTED', message: 'Federation discovery payload failed validation' } };
    }
    return { ok: true, value: parsed.data };
  }
}

/**
 * The supported federation-discovery path until federated-mcp ships a real discovery API
 * (ADR-046). The server list comes from operator configuration rather than from the federation
 * layer, which removes the only untrusted input discovery ever had — but changes nothing else:
 * `registerDiscoveredFederation` still records capabilities as merely *discovered*, and
 * `ConnectorGateway.invoke` still refuses them until a human approval binds the schema hash.
 *
 * Operators compute `schemaHash` with the exported `capabilitySchemaHash` over the tool's real
 * input schema, so a hand-maintained entry that drifts from the server's actual schema fails
 * closed at the gateway instead of silently authorizing the wrong tool.
 */
export class StaticFederatedMcpDiscovery implements FederatedMcpDiscoveryPort {
  private readonly servers: readonly FederatedServerDescriptor[];

  constructor(servers: readonly FederatedServerDescriptor[]) {
    this.servers = servers;
  }

  async listServers(): Promise<Result<readonly FederatedServerDescriptor[]>> {
    return { ok: true, value: this.servers };
  }

  async listCapabilities(serverId: string): Promise<Result<readonly DiscoveredCapability[]>> {
    const server = this.servers.find((candidate) => candidate.serverId === serverId);
    return server === undefined
      ? { ok: false, error: { code: 'NOT_FOUND', message: 'Unknown federated server' } }
      : { ok: true, value: server.capabilities };
  }
}

/**
 * Pins the schema locally so a federated server cannot hand over a hash that matches a previously
 * approved capability while serving a different schema.
 */
export function capabilitySchemaHash(name: string, inputSchema: unknown): string {
  return createHash('sha256').update(canonicalize({ name, inputSchema })).digest('hex');
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : 1));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(',')}}`;
}

function parseHost(endpoint: string): string | undefined {
  try {
    return new URL(endpoint).host || undefined;
  } catch {
    return undefined;
  }
}
