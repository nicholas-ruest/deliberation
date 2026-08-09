import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpFederatedMcpDiscovery } from '../../src/integrations/infrastructure/federated-mcp-discovery.js';
import { EnvSecretProvider } from '../../src/platform/security/secret-provider.js';

/**
 * ADR-046: the real contract test. Unlike `federated-mcp-discovery.test.ts`, which proves the
 * adapter's own logic against a fake transport, this file builds and runs the actual
 * `github.com/ruvnet/federated-mcp` tree in a throwaway container and asserts what it really
 * serves. It is what turned the adapter's "ASSUMED, UNVERIFIED HTTP CONTRACT" header into a
 * verified finding: federated-mcp exposes no HTTP discovery surface whatsoever.
 *
 * Gated like the `TEST_DATABASE_URL` suites: opt in with `FEDERATED_MCP_LIVE_CONTRACT=1` and a
 * working Docker daemon, since it clones upstream and builds an image. Without either it skips
 * cleanly rather than failing.
 */
const optedIn = process.env['FEDERATED_MCP_LIVE_CONTRACT'] !== undefined;

const dockerAvailable = ((): boolean => {
  if (!optedIn) return false;
  try {
    execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
})();

const suite = optedIn && dockerAvailable ? describe : describe.skip;

/** The upstream tree HEAD at verification time (2024-11-26); pinned so the contract cannot drift. */
const UPSTREAM_REPO = 'https://github.com/ruvnet/federated-mcp.git';
const UPSTREAM_COMMIT = '486dc9c022a51bea0775e645e206336ee66212de';
const IMAGE = `federated-mcp-contract:${UPSTREAM_COMMIT.slice(0, 7)}`;

const BANNER = 'AI Federation Network Online';

/**
 * Upstream's own committed Dockerfile pins `denoland/deno:1.40.2` but its committed `deno.lock`
 * files are lockfile v4, which that Deno rejects outright ("Unsupported lockfile version '4'") —
 * so the image cannot run its own source without `--no-lock`. Keeping the pinned base image and
 * dropping only the lockfile is the smallest deviation that still runs the real entrypoint.
 */
const DOCKERFILE = `FROM denoland/deno:1.40.2
WORKDIR /app
COPY . .
RUN deno cache --no-lock src/apps/deno/server.ts
EXPOSE 3000
CMD ["deno","run","--no-lock","--allow-net","--allow-env","--allow-read","--allow-write","--allow-run","src/apps/deno/server.ts"]
`;

const run = (command: string, args: readonly string[], cwd?: string): string =>
  execFileSync(command, [...args], { cwd, stdio: 'pipe', encoding: 'utf8' });

async function reserveFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => (port === 0 ? reject(new Error('Could not reserve a port')) : resolve(port)));
    });
  });
}

function imageExists(): boolean {
  try {
    return run('docker', ['image', 'inspect', IMAGE, '--format', '{{.Id}}']).trim().length > 0;
  } catch {
    return false;
  }
}

function buildImage(): void {
  if (imageExists()) return;
  const checkout = mkdtempSync(join(tmpdir(), 'federated-mcp-'));
  try {
    run('git', ['init', '--quiet'], checkout);
    run('git', ['remote', 'add', 'origin', UPSTREAM_REPO], checkout);
    run('git', ['fetch', '--quiet', '--depth', '1', 'origin', UPSTREAM_COMMIT], checkout);
    run('git', ['checkout', '--quiet', 'FETCH_HEAD'], checkout);
    writeFileSync(join(checkout, 'Dockerfile.contract'), DOCKERFILE);
    run('docker', ['build', '--quiet', '--file', 'Dockerfile.contract', '--tag', IMAGE, '.'], checkout);
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
}

let baseUrl = '';
let container = '';

suite('federated-mcp live contract (ADR-046)', () => {
  beforeAll(async () => {
    buildImage();
    const port = await reserveFreePort();
    container = `federated-mcp-contract-${randomUUID().slice(0, 8)}`;
    run('docker', ['run', '--detach', '--name', container, '--publish', `127.0.0.1:${port}:3000`, IMAGE]);
    baseUrl = `http://127.0.0.1:${port}`;

    for (let attempt = 0; attempt < 90; attempt += 1) {
      try {
        const probe = await fetch(baseUrl, { signal: AbortSignal.timeout(2_000) });
        if (probe.status === 200) return;
      } catch { /* still starting */ }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new Error(`federated-mcp container never became ready:\n${run('docker', ['logs', container])}`);
  }, 900_000);

  afterAll(() => {
    if (container === '') return;
    try { run('docker', ['rm', '--force', container]); } catch { /* already gone */ }
  });

  it('serves only a plain-text banner, with no router behind it', async () => {
    const response = await fetch(baseUrl);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/text\/plain/);
    expect((await response.text()).trim()).toBe(BANNER);
  });

  it('returns that same banner for every discovery path ADR-037 assumed, under every method', async () => {
    const paths = [
      '/federation/servers',
      '/federation/servers/demo/tools',
      '/api/federation/servers',
      '/info',
      '/capabilities',
      '/mcp',
      // An invented path proves the point: there is no route table, so there is no 404 either.
      '/totally-made-up-path-9f3',
    ];

    for (const path of paths) {
      const response = await fetch(`${baseUrl}${path}`);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('content-type'), path).toMatch(/text\/plain/);
      expect((await response.text()).trim(), path).toBe(BANNER);
    }

    for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS'] as const) {
      const response = await fetch(`${baseUrl}/federation/servers`, { method });
      expect(response.status, method).toBe(200);
      expect((await response.text()).trim(), method).toBe(BANNER);
    }
  });

  it('never serves JSON, so no discovery payload can be parsed off any path', async () => {
    for (const path of ['/', '/federation/servers', '/federation/servers/demo/tools']) {
      await expect((await fetch(`${baseUrl}${path}`)).json(), path).rejects.toThrow();
    }
  });

  it('fails the HTTP adapter closed against the real instance instead of misreading the banner', async () => {
    // The adapter requires an https endpoint because a real deployment terminates TLS at an
    // ingress. TLS termination is the only thing stubbed here: the client below performs a real
    // request against the real container and returns its real status and body.
    const discovery = new HttpFederatedMcpDiscovery({
      secrets: new EnvSecretProvider({ FEDERATED_MCP_ENDPOINT: 'https://federation.invalid' }),
      http: async (url, init) => {
        const response = await fetch(`${baseUrl}${new URL(url).pathname}`, init);
        return { ok: response.ok, status: response.status, json: () => response.json() };
      },
    });

    const servers = await discovery.listServers();

    // A 200 that is not JSON must not be mistaken for an empty federation.
    expect(servers.ok).toBe(false);
    expect(!servers.ok && servers.error.code).toBe('CONTENT_REJECTED');

    const capabilities = await discovery.listCapabilities('demo');
    expect(!capabilities.ok && capabilities.error.code).toBe('CONTENT_REJECTED');
  });
});
