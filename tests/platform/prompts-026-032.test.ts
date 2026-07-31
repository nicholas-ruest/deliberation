import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CellPlacementGuard } from '../../src/platform/runtime/index.js';
import { ManagedImmutableObjectStore, type BlobClient, type EnvelopeKeyService } from '../../src/platform/persistence/index.js';
import { DurableInbox, TenantFairScheduler, type QueueDelivery } from '../../src/platform/workflows/index.js';
import { MemoryReplayStore, TrustedIdentityVerifier, authorizeWorkload } from '../../src/platform/security/index.js';
import { ReleaseAuthority, authorizationDigest, bundleDigest, type ReleaseBundle } from '../../src/platform/release/index.js';
import { ProductionDependency } from '../../src/integrations/domain/entities/index.js';
import { VersionedDependencyCatalog } from '../../src/integrations/application/index.js';
import { ModelGateway } from '../../src/platform/model-gateway/index.js';
import { renderHumanAuthorityBrief } from '../../src/web/index.js';

describe('prompt 026 regional cell placement', () => {
  it('rejects cross-cell and cross-region execution', () => {
    const guard = new CellPlacementGuard(new Map([['tenant-a', { tenantId: 'tenant-a', cellId: 'eu-1a', region: 'eu-1' }]]));
    expect(guard.authorize('tenant-a', 'eu-1a', 'eu-1').ok).toBe(true);
    expect(guard.authorize('tenant-a', 'us-1a', 'us-1')).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
  });
});

describe('prompt 027 managed regional data plane', () => {
  it('uses opaque cell/tenant partitions, verifies hashes, and denies cross-cell reads', async () => {
    const objects = new Map<string, Uint8Array>();
    const blobs: BlobClient = {
      put: async (key, content) => { objects.set(key, content); },
      get: async (key) => objects.get(key),
      delete: async (key) => { objects.delete(key); },
    };
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const keys: EnvelopeKeyService = {
      generate: async () => ({ plaintext: dataKey, wrapped: { keyReference: 'kms/key/1', ciphertext: Uint8Array.from([1]) } }),
      unwrap: async () => dataKey,
      rotate: async (_context, wrapped) => wrapped,
      destroy: async () => undefined,
    };
    const store = new ManagedImmutableObjectStore(blobs, keys);
    const context = { tenantId: 'tenant-secret-name', principalId: 'principal-a', cellId: 'eu-1a' };
    const put = await store.put(context, 'evidence', Buffer.from('immutable evidence'), {
      sensitivity: 'restricted', purpose: 'deliberation', retentionPolicy: 'P30D',
    });
    expect(put.ok).toBe(true);
    if (!put.ok) return;
    expect(put.value.opaqueKey).not.toContain(context.tenantId);
    const read = await store.get(context, put.value, { keyReference: put.value.keyReference, ciphertext: Uint8Array.from([1]) });
    expect(read.ok && Buffer.from(read.value).toString()).toBe('immutable evidence');
    expect((await store.get({ ...context, cellId: 'us-1a' }, put.value, {
      keyReference: put.value.keyReference, ciphertext: Uint8Array.from([1]),
    })).ok).toBe(false);
    objects.set(put.value.opaqueKey, Uint8Array.from([99]));
    expect((await store.get(context, put.value, {
      keyReference: put.value.keyReference, ciphertext: Uint8Array.from([1]),
    })).ok).toBe(false);
    expect((await store.erase(context, put.value)).ok).toBe(true);
    expect(objects.has(put.value.opaqueKey)).toBe(false);
  });
});

describe('prompt 028 durable delivery semantics', () => {
  it('deduplicates per tenant, fences stale generations, and schedules tenants fairly', () => {
    const inbox = new DurableInbox();
    const envelope = { eventId: 'same', tenantId: 'a', workflowId: 'w', generation: 2, schemaVersion: 1, payload: {} };
    expect(inbox.accept(envelope, 2).ok).toBe(true);
    expect(inbox.accept(envelope, 2).ok).toBe(true);
    expect(inbox.accept({ ...envelope, eventId: 'stale', generation: 1 }, 2).ok).toBe(false);
    const delivery = (tenantId: string, receipt: string): QueueDelivery => ({
      receipt, envelope: { ...envelope, tenantId, eventId: receipt },
    });
    const selected = new TenantFairScheduler().select([
      delivery('a', 'a1'), delivery('a', 'a2'), delivery('b', 'b1'), delivery('b', 'b2'),
    ], 4);
    expect(selected.map(({ envelope: item }) => item.tenantId)).toEqual(['a', 'b', 'a', 'b']);
  });
});

describe('prompt 029 trusted identities', () => {
  it('verifies asymmetric claims, rejects replay, and binds workload cell/audience', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: 'key-1' })).toString('base64url');
    const now = 1_800_000_000;
    const payload = Buffer.from(JSON.stringify({
      iss: 'https://identity.example', aud: 'deliberation-api', sub: 'principal-a', tenant_id: 'tenant-a',
      session_epoch: 4, jti: 'one-time', iat: now - 1, nbf: now - 1, exp: now + 60,
    })).toString('base64url');
    const signature = sign(null, Buffer.from(`${header}.${payload}`), privateKey).toString('base64url');
    const verifier = new TrustedIdentityVerifier(new Map([['https://identity.example', {
      issuer: 'https://identity.example', audiences: ['deliberation-api'], keys: new Map([['key-1', publicKey]]),
    }]]), new MemoryReplayStore(), () => now);
    const token = `${header}.${payload}.${signature}`;
    expect(verifier.verify(token, 'deliberation-api').ok).toBe(true);
    expect(verifier.verify(token, 'deliberation-api')).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
    expect(authorizeWorkload(
      { service: 'worker', cellId: 'eu-1a', audience: 'queue' },
      { service: 'worker', cellId: 'eu-1a', audience: 'queue' },
    ).ok).toBe(true);
    expect(authorizeWorkload(
      { service: 'worker', cellId: 'us-1a', audience: 'queue' },
      { service: 'worker', cellId: 'eu-1a', audience: 'queue' },
    ).ok).toBe(false);
  });
});

describe('prompt 030 independent release authority', () => {
  it('binds the complete bundle, consumes approval once, and uses CAS fencing', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const approverKeys = generateKeyPairSync('ed25519');
    const digestValue = (name: string) => Buffer.from(name.repeat(64)).subarray(0, 32).toString('hex');
    const bundle: ReleaseBundle = {
      sourceDigest: digestValue('s'), apiImageDigest: digestValue('a'), workerImageDigest: digestValue('w'),
      webImageDigest: digestValue('z'), sbomDigest: digestValue('b'), configurationDigest: digestValue('c'),
      schemaDigest: digestValue('h'), migrationDigest: digestValue('m'), evaluationDigest: digestValue('e'),
      builderId: 'builder', createdAt: new Date(0).toISOString(),
    };
    let version = 3;
    const authority = new ReleaseAuthority(
      new Map([['builder-key', { builderId: 'builder', publicKey, revoked: false }]]),
      new Map([['release-key', { approverId: 'release-admin', publicKey: approverKeys.publicKey, revoked: false }]]),
      {
      currentVersion: async () => version,
      reconcile: async (_environment, _bundle, expected) => {
        if (expected !== version) return false;
        version += 1;
        return true;
      },
      },
      digestValue('p'),
      () => new Date('2026-08-01T00:00:00Z'),
    );
    const digest = bundleDigest(bundle);
    const signed = { bundle, keyId: 'builder-key', signature: sign(null, Buffer.from(digest), privateKey).toString('base64url') };
    const authorization = {
      approvalId: 'approval-1', approverId: 'release-admin', role: 'release' as const,
      environment: 'staging', from: 'integration', to: 'staging', bundleDigest: digest,
      expectedDeploymentVersion: 3, policyDigest: digestValue('p'),
      issuedAt: '2026-07-31T12:00:00Z', expiresAt: '2026-08-01T12:00:00Z',
    };
    const approved = {
      authorization, keyId: 'release-key',
      signature: sign(null, Buffer.from(authorizationDigest(authorization)), approverKeys.privateKey).toString('base64url'),
    };
    expect((await authority.promote(signed, approved)).ok).toBe(true);
    expect((await authority.promote(signed, approved)).ok).toBe(false);
  });
});

describe('prompt 031 dependency qualification', () => {
  it('defaults unqualified, expired, drifted, and wrong-region dependencies to denied', () => {
    const dependency = new ProductionDependency({
      id: 'model-a', version: 1, immutableProviderVersion: 'model-2026-07-31', owner: 'ml-platform',
      purpose: 'generation', dataClasses: ['internal'], regions: ['eu-1'], retentionDays: 0,
      permitsTraining: false, fixtureHash: 'fixture', killSwitchId: 'model-a', exitPlan: 'export and revoke',
      reviewedAt: new Date('2026-07-01'), expiresAt: new Date('2027-01-01'), driftFingerprint: 'known',
    });
    expect(dependency.decide('eu-1', 'internal', new Date('2026-08-01'), 'known').ok).toBe(false);
    dependency.startQualification();
    dependency.markEligible(true);
    expect(dependency.decide('eu-1', 'internal', new Date('2026-08-01'), 'known').ok).toBe(true);
    expect(dependency.decide('us-1', 'internal', new Date('2026-08-01'), 'known').ok).toBe(false);
    expect(dependency.decide('eu-1', 'internal', new Date('2026-08-01'), 'drift').ok).toBe(false);
    expect(dependency.state).toBe('quarantined');
  });
  it('blocks unqualified model calls before the provider and fences catalog drift', async () => {
    const providerCalls: string[] = [];
    const dependency = new ProductionDependency({
      id: 'provider-a', version: 1, immutableProviderVersion: 'model-2026-07-31', owner: 'ml-platform',
      purpose: 'generation', dataClasses: ['internal'], regions: ['eu-1'], retentionDays: 0,
      permitsTraining: false, fixtureHash: 'fixture', killSwitchId: 'provider-a', exitPlan: 'revoke',
      reviewedAt: new Date('2026-07-01'), expiresAt: new Date('2027-01-01'), driftFingerprint: 'known',
    });
    const catalog = new VersionedDependencyCatalog(new Map([['provider-a', dependency]]), () => new Date('2026-08-01'));
    const gateway = new ModelGateway({
      id: 'routes', version: 1, routes: [{
        providerId: 'provider-a', immutableModelId: 'model-2026-07-31', tasks: ['generation'],
        regions: ['eu-1'], maximumRiskTier: 'high', permitsRestrictedData: false,
        maximumCostMinorUnits: 10, priority: 1,
      }],
    }, new Map([['provider-a', {
      invoke: async () => {
        providerCalls.push('called');
        return { output: { answer: true }, usage: { inputTokens: 1, outputTokens: 1, costMinorUnits: 1 }, providerRequestId: 'p' };
      },
    }]]), catalog);
    const request = {
      task: 'generation' as const, tenantId: 'tenant', region: 'eu-1', riskTier: 'low' as const,
      containsRestrictedData: false, maximumCostMinorUnits: 10, promptTemplateId: 't', promptTemplateHash: 'h',
      parameters: {}, input: {}, evidenceManifest: [], toolManifest: [], safetyConfigurationHash: 's',
      dataClass: 'internal', dependencyDriftFingerprint: 'known',
    };
    expect((await gateway.invoke(request, z.object({ answer: z.boolean() }))).ok).toBe(false);
    expect(providerCalls).toHaveLength(0);
    dependency.startQualification();
    dependency.markEligible(true);
    expect((await gateway.invoke(request, z.object({ answer: z.boolean() }))).ok).toBe(true);
    expect(providerCalls).toHaveLength(1);
  });
  it('rejects mutable provider aliases', () => {
    expect(() => new ProductionDependency({
      id: 'bad', version: 1, immutableProviderVersion: 'model-latest', owner: 'x', purpose: 'x',
      dataClasses: ['x'], regions: ['x'], retentionDays: 0, permitsTraining: false, fixtureHash: 'x',
      killSwitchId: 'x', exitPlan: 'x', reviewedAt: new Date(), expiresAt: new Date(Date.now() + 1), driftFingerprint: 'x',
    })).toThrow(/mutable/);
  });
});

describe('prompt 032 accessible human-authority view', () => {
  it('encodes untrusted content and keeps abstention, citations, and authority explicit', () => {
    const html = renderHumanAuthorityBrief({
      title: '<script>alert(1)</script>',
      claims: [{ text: '<img src=x onerror=alert(1)>', epistemicClass: 'model-inference', citations: [
        { label: 'source', href: 'javascript:alert(1)' },
      ] }],
      dissent: ['Stakeholder B disagrees'], assumptions: ['Demand stays flat'], limitations: ['Sparse data'],
      abstention: { reason: 'Missing evidence', unblockConditions: ['Obtain audited figures'] },
    }, '"csrf');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('javascript:alert');
    expect(html).toContain('The platform has not made your decision');
    expect(html).toContain('role="status"');
    expect(html).toContain('Inspect citations');
    expect(html).toContain('Abstention');
    expect(html).not.toContain('/decision-intent');
  });
});
