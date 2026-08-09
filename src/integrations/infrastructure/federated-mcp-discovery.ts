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
 * ASSUMED, UNVERIFIED HTTP CONTRACT.
 *
 * `github.com/ruvnet/federated-mcp` is a standalone service, not an importable library: its
 * `package.json` declares no name/version/main/exports, and it ships its own Dockerfile and
 * start.sh. Its committed HTTP server currently answers only `GET /` with the plain-text banner
 * "AI Federation Network Online"; its documented surface (docs/api.md) is the in-process
 * `FederationProxy` API (`registerServer`, `removeServer`, `getConnectedServers`) plus the
 * `FederationConfig` and `MCPCapabilities` types. There is therefore no published read-only HTTP
 * discovery API to code against, and none of the below has been exercised against a live
 * instance.
 *
 * This adapter targets a minimal read-only projection of those documented types:
 *
 *   GET {base}/federation/servers
 *     -> 200 { "servers": [ { "serverId": "...",
 *                             "endpointIdentity": "sha256:...",
 *                             "transport": "streamable-http" | "stdio",
 *                             "endpoints": { "control": "wss://...", "data": "https://host/mcp" } } ] }
 *
 *   GET {base}/federation/servers/{serverId}/tools
 *     -> 200 { "tools": [ { "name": "...",
 *                           "inputSchema": { ... },
 *                           "annotations": { "readOnlyHint": true } } ] }
 *
 * The tools payload is the MCP specification's `tools/list` result shape, which federated-mcp
 * proxies. If a real deployment differs, replace the two path constants and the two zod schemas
 * below; nothing outside this file depends on the wire format.
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
