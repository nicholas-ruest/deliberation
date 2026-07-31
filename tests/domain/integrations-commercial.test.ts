import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FixedClock } from '../../src/shared/domain/index.js';
import { Entitlement } from '../../src/commercial-operations/domain/index.js';
import { ConnectorRegistration } from '../../src/integrations/domain/index.js';
import { ConnectorGateway } from '../../src/integrations/application/index.js';
import { ModelGateway } from '../../src/platform/model-gateway/index.js';

const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));

describe('commercial operations', () => {
  it('reserves maximum budget and idempotently consumes content-free units', () => {
    const entitlement = Entitlement.create('e', 't', ['planning.scenario.run'], clock);
    for (const dimension of ['tokens', 'moneyMinorUnits', 'toolCalls', 'branches', 'wallTimeMs', 'concurrency'] as const) {
      entitlement.setQuota(dimension, { hardLimit: 100, allowOverage: false });
    }
    const request = { tokens: 10, moneyMinorUnits: 10, toolCalls: 2, branches: 2, wallTimeMs: 50, concurrency: 1 };
    expect(entitlement.reserve('r', request, new Date('2026-01-02')).ok).toBe(true);
    expect(entitlement.reserve('r2', { ...request, tokens: 100 }, new Date('2026-01-02')).ok).toBe(false);
    const receipt = { id: 'u', reservationId: 'r', dimension: 'tokens' as const, quantity: 5, sourceReference: 'provider-receipt', occurredAt: clock.now() };
    expect(entitlement.consume(receipt).ok).toBe(true);
    expect(entitlement.consume(receipt).ok).toBe(true);
  });
});

describe('connector and model gateways', () => {
  it('pins connector schema and rejects unreviewed writes', async () => {
    const registered = ConnectorRegistration.register({
      id: 'connector', tenantId: 'tenant', endpointIdentity: 'sha256:endpoint',
      transport: 'streamable-http', credentialReference: 'secret://connector', allowedHosts: ['api.example'],
    }, clock);
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    registered.value.discover({ name: 'create', schemaHash: 'schema-1', capabilityClass: 'write' });
    registered.value.approve('create', 'schema-1', 'admin', clock.now());
    const gateway = new ConnectorGateway(registered.value, { call: async () => ({ id: 'remote' }) });
    const result = await gateway.invoke({
      tenantId: 'tenant', capability: 'create', schemaHash: 'schema-1', capabilityClass: 'write',
      targetHost: 'api.example', purpose: 'approved-action', input: {},
    }, {
      effect: 'allow', obligations: [], policySetId: 'p', policyVersion: 1,
    }, z.object({ id: z.string() }));
    expect(result.ok).toBe(false);
  });

  it('selects only immutable region/privacy/risk compliant model routes', async () => {
    const gateway = new ModelGateway({
      id: 'router', version: 1, routes: [{
        providerId: 'fake', immutableModelId: 'model-2026-01-01', tasks: ['generation'],
        regions: ['eu'], maximumRiskTier: 'high', permitsRestrictedData: true,
        maximumCostMinorUnits: 10, priority: 1,
      }],
    }, new Map([['fake', {
      invoke: async () => ({ output: { answer: 'ok' }, usage: { inputTokens: 1, outputTokens: 1, costMinorUnits: 1 }, providerRequestId: 'request' }),
    }]]));
    const result = await gateway.invoke({
      task: 'generation', tenantId: 'tenant', region: 'eu', riskTier: 'high',
      containsRestrictedData: true, maximumCostMinorUnits: 10,
      promptTemplateId: 'prompt', promptTemplateHash: 'hash', parameters: {},
      input: {}, evidenceManifest: ['e'], toolManifest: [], safetyConfigurationHash: 'safe',
    }, z.object({ answer: z.string() }));
    expect(result.ok && result.value.immutableModelId).toBe('model-2026-01-01');
  });
});
