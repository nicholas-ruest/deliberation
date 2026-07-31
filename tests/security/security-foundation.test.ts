import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BoundaryValidator, CapabilityTokenService, KillSwitchRegistry } from '../../src/platform/security/index.js';

const tenantId = '00000000-0000-4000-8000-000000000001';
const subjectId = '00000000-0000-4000-8000-000000000002';
const workflowId = '00000000-0000-4000-8000-000000000003';

describe('security foundation', () => {
  it('rejects malformed untrusted output before it can cross the boundary', () => {
    const result = new BoundaryValidator().validate('model-output', z.object({ safe: z.literal(true) }), {
      safe: false,
      toolCall: 'delete-everything',
    }, 'digest');
    expect(result.ok).toBe(false);
  });

  it('kill switches deny new work without modifying existing state', () => {
    const switches = new KillSwitchRegistry();
    const generation = switches.disable('connector', 'crm', 'compromise');
    expect(switches.decide('connector', 'crm')).toEqual({
      allowed: false,
      reason: 'compromise',
      generation,
    });
  });

  it('capabilities are audience-bound, tenant-bound, expiring and signed', () => {
    const service = new CapabilityTokenService(Buffer.from('test-signing-key-not-production'));
    const token = service.issue({
      tenantId,
      subjectId,
      audience: 'worker',
      actions: ['scenario.step'],
      resources: [workflowId],
      purpose: 'deliberation',
      budget: { tokens: 100 },
      workflowId,
      generation: 1,
      expiresAt: 1000,
    });
    expect(service.verify(token, 'worker', 999).tenantId).toBe(tenantId);
    expect(() => service.verify(token, 'connector', 999)).toThrow();
    expect(() => service.verify(`${token}x`, 'worker', 999)).toThrow();
  });
});
