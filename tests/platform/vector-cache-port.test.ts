import { describe, expect, it } from 'vitest';
import {
  InMemoryVectorCache,
  RuLakeVectorCache,
  type RuLakeHttpClient,
  type RuLakeHttpResponse,
  type VectorCacheKey,
  type VectorCachePort,
} from '../../src/platform/persistence/index.js';
import { EnvSecretProvider } from '../../src/platform/security/secret-provider.js';
import { ProductionDependency } from '../../src/integrations/domain/entities/production-dependency.js';

const key = (suffix: string): VectorCacheKey => ({ tenantId: 'tenant-a', purpose: 'evidence-search', queryDigest: `digest-${suffix}` });

/**
 * ADR-007's dual-adapter discipline applied to ADR-038: both the real baseline
 * (InMemoryVectorCache) and RuLake's HTTP client must satisfy the exact same
 * contract, so a caller depending on VectorCachePort never has to know which
 * one it is talking to.
 */
function contractTests(name: string, makeCache: () => VectorCachePort) {
  describe(`VectorCachePort contract: ${name}`, () => {
    it('returns undefined on a miss', async () => {
      const cache = makeCache();
      expect(await cache.get(key('miss'))).toBeUndefined();
    });

    it('returns what was set', async () => {
      const cache = makeCache();
      await cache.set(key('a'), { value: { matches: [1, 2, 3] }, cachedAt: new Date('2026-08-09T00:00:00Z'), sourceVersion: 'v1' });
      const result = await cache.get<{ matches: number[] }>(key('a'));
      expect(result).toEqual({ value: { matches: [1, 2, 3] }, cachedAt: new Date('2026-08-09T00:00:00Z'), sourceVersion: 'v1' });
    });

    it('invalidate removes exactly the targeted key', async () => {
      const cache = makeCache();
      await cache.set(key('a'), { value: 'a', cachedAt: new Date(), sourceVersion: 'v1' });
      await cache.set(key('b'), { value: 'b', cachedAt: new Date(), sourceVersion: 'v1' });
      await cache.invalidate(key('a'));
      expect(await cache.get(key('a'))).toBeUndefined();
      expect((await cache.get<string>(key('b')))?.value).toBe('b');
    });

    it('invalidatePartition drops every entry for that tenant+purpose, nothing else', async () => {
      const cache = makeCache();
      await cache.set(key('a'), { value: 'a', cachedAt: new Date(), sourceVersion: 'v1' });
      const otherTenantKey: VectorCacheKey = { tenantId: 'tenant-b', purpose: 'evidence-search', queryDigest: 'digest-a' };
      await cache.set(otherTenantKey, { value: 'other', cachedAt: new Date(), sourceVersion: 'v1' });
      await cache.invalidatePartition('tenant-a', 'evidence-search');
      expect(await cache.get(key('a'))).toBeUndefined();
      expect((await cache.get<string>(otherTenantKey))?.value).toBe('other');
    });
  });
}

contractTests('InMemoryVectorCache (working baseline)', () => new InMemoryVectorCache());

function fakeRuLakeCache(): VectorCachePort {
  const store = new Map<string, unknown>();
  const http: RuLakeHttpClient = async (url, init) => {
    const path = new URL(url).pathname;
    if (init.method === 'GET') {
      const body = store.get(path);
      const response: RuLakeHttpResponse = { ok: body !== undefined, status: body !== undefined ? 200 : 404, json: async () => body };
      return response;
    }
    if (init.method === 'PUT') {
      store.set(path, JSON.parse(init.body ?? '{}'));
      return { ok: true, status: 204, json: async () => undefined };
    }
    // DELETE: exact key, or (for a partition path) every key sharing that prefix.
    for (const stored of [...store.keys()]) if (stored === path || stored.startsWith(`${path}/`)) store.delete(stored);
    return { ok: true, status: 204, json: async () => undefined };
  };
  return new RuLakeVectorCache({ secrets: new EnvSecretProvider({ RULAKE_ENDPOINT: 'https://rulake.invalid' }), http });
}

contractTests('RuLakeVectorCache (fake HTTP transport — no real RuLake artifact exists to test against)', fakeRuLakeCache);

describe('RuLakeVectorCache fails open, never surfaces a broken dependency to the caller', () => {
  it('an unreachable endpoint is treated as a permanent miss on get()', async () => {
    const cache = new RuLakeVectorCache({ secrets: new EnvSecretProvider({ RULAKE_ENDPOINT: 'http://127.0.0.1:1' }), timeoutMs: 200 });
    await expect(cache.get(key('x'))).resolves.toBeUndefined();
  });

  it('an unreachable endpoint does not throw on set()/invalidate()/invalidatePartition()', async () => {
    const cache = new RuLakeVectorCache({ secrets: new EnvSecretProvider({ RULAKE_ENDPOINT: 'http://127.0.0.1:1' }), timeoutMs: 200 });
    await expect(cache.set(key('x'), { value: 1, cachedAt: new Date(), sourceVersion: 'v1' })).resolves.toBeUndefined();
    await expect(cache.invalidate(key('x'))).resolves.toBeUndefined();
    await expect(cache.invalidatePartition('tenant-a', 'evidence-search')).resolves.toBeUndefined();
  });
});

describe('RuLake production-dependency qualification (ADR-038, ADR-031)', () => {
  // Unlike ADR-035/036 (a supply-chain vulnerability, real package installed) and ADR-039
  // (real package, missing evaluation evidence), RuLake has no runnable artifact at all: zero
  // GitHub releases, no npm package, no crates.io crate. There is nothing to qualify a version
  // *of* yet, so this stays in `draft` — it does not even reach `startQualification()`.
  const qualification = {
    id: 'rulake', version: 1, immutableProviderVersion: 'unreleased', owner: 'platform-team',
    purpose: 'vector-cache-acceleration', dataClasses: ['internal'], regions: ['eu-1'],
    retentionDays: 0, permitsTraining: false, fixtureHash: 'none',
    killSwitchId: 'rulake-vector-cache', exitPlan: 'Remove RuLakeVectorCache from wherever it was '
      + 'bound; InMemoryVectorCache (or the underlying vector store directly) is the unconditional '
      + 'default and needs no code change to keep working. Blocked on: RuLake has never published a '
      + 'runnable artifact (0 GitHub releases, no npm/crates.io package) as of this ADR.',
    reviewedAt: new Date('2026-08-09T00:00:00.000Z'), expiresAt: new Date('2027-08-09T00:00:00.000Z'),
    driftFingerprint: 'unreleased',
  };

  it('constructs but never enters qualification, let alone eligible', () => {
    const dependency = new ProductionDependency(qualification);
    expect(dependency.state).toBe('draft');
    const decision = dependency.decide('eu-1', 'internal', new Date('2026-08-09T01:00:00.000Z'), qualification.driftFingerprint);
    expect(decision.ok).toBe(false);
  });
});
