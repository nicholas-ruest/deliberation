import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SynthLangCompressor } from '../../src/platform/model-gateway/synthlang-compressor.js';
import { ProductionDependency } from '../../src/integrations/domain/entities/production-dependency.js';

describe('SynthLangCompressor against a fake sidecar (adapter contract)', () => {
  let server: Server;
  let baseUrl: string;

  afterEach(() => {
    server?.close();
  });

  it('returns a compression result when the sidecar responds 200', async () => {
    server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => { body += String(chunk); });
      request.on('end', () => {
        expect(JSON.parse(body)).toMatchObject({ text: 'hello world' });
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ original: 'hello world', compressed: 'hi', originalTokens: 2, compressedTokens: 1 }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`;

    const compressor = new SynthLangCompressor(baseUrl);
    const result = await compressor.compress('hello world');
    expect(result).toEqual({ ok: true, value: { original: 'hello world', compressed: 'hi', originalTokens: 2, compressedTokens: 1 } });
  });

  it('surfaces a 503 (sidecar unconfigured) as a retryable DEPENDENCY_UNAVAILABLE, not a crash', async () => {
    server = createServer((_request, response) => {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'OPENAI_API_KEY is not configured for this sidecar' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`;

    const compressor = new SynthLangCompressor(baseUrl);
    const result = await compressor.compress('hello world');
    expect(result).toMatchObject({ ok: false, error: { code: 'DEPENDENCY_UNAVAILABLE', retryable: true } });
  });

  it('rejects a malformed sidecar response instead of returning it as-is', async () => {
    server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ unexpected: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`;

    const compressor = new SynthLangCompressor(baseUrl);
    const result = await compressor.compress('hello world');
    expect(result).toMatchObject({ ok: false, error: { code: 'CONTENT_REJECTED' } });
  });

  it('surfaces an unreachable sidecar as a retryable DEPENDENCY_UNAVAILABLE', async () => {
    const compressor = new SynthLangCompressor('http://127.0.0.1:1');
    const result = await compressor.compress('hello world');
    expect(result).toMatchObject({ ok: false, error: { code: 'DEPENDENCY_UNAVAILABLE', retryable: true } });
  });
});

const pythonBinary = process.env['SYNTHLANG_SIDECAR_PYTHON'];
const sidecarSuite = pythonBinary === undefined ? describe.skip : describe;

sidecarSuite('SynthLangCompressor against the real Python sidecar (ADR-039, no API key configured)', () => {
  let child: ChildProcessWithoutNullStreams;
  let baseUrl: string;

  beforeAll(async () => {
    const serverPath = fileURLToPath(new URL('../../scripts/synthlang-sidecar/server.py', import.meta.url));
    const port = 8237;
    baseUrl = `http://127.0.0.1:${port}`;
    child = spawn(pythonBinary as string, [serverPath], {
      env: { ...process.env, PORT: String(port), OPENAI_API_KEY: '' },
      stdio: 'pipe',
    });
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${baseUrl}/health/live`);
        if (response.status === 200) return;
      } catch { /* not listening yet */ }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error('Real SynthLang sidecar did not become live in time');
  }, 30_000);

  afterAll(() => {
    child?.kill('SIGTERM');
  });

  it('fails closed with 503 when OPENAI_API_KEY is unset, surfaced as DEPENDENCY_UNAVAILABLE', async () => {
    const compressor = new SynthLangCompressor(baseUrl);
    const result = await compressor.compress('Please review this quarterly report and summarize the key risks.');
    expect(result).toMatchObject({ ok: false, error: { code: 'DEPENDENCY_UNAVAILABLE', retryable: true } });
  });

  it('reports not-ready while unconfigured', async () => {
    const response = await fetch(`${baseUrl}/health/ready`);
    expect(response.status).toBe(503);
  });
});

describe('SynthLang production-dependency qualification (ADR-039, ADR-031)', () => {
  // Unlike ADR-035/036's blocker (a supply-chain vulnerability), SynthLang's own dependency
  // tree carries no comparable finding as of this ADR. What is missing is a held-out
  // evaluation proving compression preserves meaning for consequential prompts -- ADR-039's
  // own Consequences section names this explicitly as the reason it stays below `eligible`.
  const qualification = {
    id: 'synthlang', version: 1, immutableProviderVersion: '0.1.4', owner: 'platform-team',
    purpose: 'prompt-compression', dataClasses: ['internal'], regions: ['eu-1'],
    retentionDays: 0, permitsTraining: false, fixtureHash: 'unfixtured-pending-qualification',
    killSwitchId: 'synthlang-compressor', exitPlan: 'Stop passing a PromptCompressor into any '
      + 'call site that constructs a ModelRequest; uncompressed prompts are the unconditional '
      + 'default and require no code change to keep working. Blocked on: no held-out '
      + 'compressed-vs-uncompressed output-quality evaluation exists yet (ADR-039, ADR-018).',
    reviewedAt: new Date('2026-08-09T00:00:00.000Z'), expiresAt: new Date('2027-08-09T00:00:00.000Z'),
    driftFingerprint: 'synthlang@0.1.4',
  };

  it('constructs in draft state and is never marked eligible', () => {
    const dependency = new ProductionDependency(qualification);
    expect(dependency.state).toBe('draft');
    dependency.startQualification();
    expect(dependency.state).toBe('qualifying');
    const decision = dependency.decide('eu-1', 'internal', new Date('2026-08-09T01:00:00.000Z'), qualification.driftFingerprint);
    expect(decision.ok).toBe(false);
  });
});
