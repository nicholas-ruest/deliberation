import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { EventFactory, FixedClock, UuidGenerator } from '../../src/shared/domain/index.js';
import { ConsentRecord, PolicySet, SafetyCase } from '../../src/governance/domain/index.js';
import { Principal, Tenant } from '../../src/identity-access/domain/index.js';

const clock = new FixedClock(new Date('2026-01-01'));

describe('governance decision branches', () => {
  it('covers default deny, obligation allow, prohibited risk and immutable activation', () => {
    const policy = PolicySet.draft('p', 't', 'author', clock);
    const rule = {
      id: 'allow', priority: 1, effect: 'allow' as const, actions: ['read'],
      roles: ['member'], purposes: ['case'], maximumRiskTier: 'moderate' as const,
      obligations: ['audit-read'],
    };
    expect(policy.addRule(rule).ok).toBe(true);
    expect(policy.addRule(rule).ok).toBe(false);
    const input = {
      tenantId: 't', subjectId: 's', roles: ['member'], action: 'read', resourceType: 'case',
      purpose: 'case', riskTier: 'low' as const, capabilities: [], consentPurposes: [],
    };
    expect(policy.evaluate(input, 'before').effect).toBe('deny');
    expect(policy.activate().ok).toBe(false);
    policy.approve('reviewer');
    expect(policy.addRule({ ...rule, id: 'late' }).ok).toBe(false);
    policy.activate();
    const allowed = policy.evaluate(input, 'allow');
    expect(allowed.effect).toBe('allow-with-obligations');
    expect(allowed.obligations).toEqual(['audit-read']);
    expect(policy.evaluate({ ...input, action: 'unknown' }, 'missing').reasonCodes).toEqual(['DEFAULT_DENY']);
    expect(policy.evaluate({ ...input, riskTier: 'prohibited' }, 'prohibited').effect).toBe('deny');
    expect(policy.evaluate({ ...input, tenantId: 'other' }, 'other').effect).toBe('deny');
  });

  it('covers consent validation and idempotent withdrawal', () => {
    expect(ConsentRecord.grant('c', 't', 's', [], [], '', clock).ok).toBe(false);
    const consent = ConsentRecord.grant('c', 't', 's', ['case'], ['restricted'], 'receipt', clock);
    if (!consent.ok) throw new Error('fixture failed');
    expect(consent.value.permits('other', 'restricted')).toBe(false);
    expect(consent.value.withdraw(clock).ok).toBe(true);
    expect(consent.value.withdraw(clock).ok).toBe(true);
  });

  it('covers invalid, expired and suspended safety cases', () => {
    const prohibited = SafetyCase.draft('bad', 't', 'author', 'use', 'prohibited', [], new Date('2027-01-01'), clock);
    expect(prohibited.validate().ok).toBe(false);
    const safety = SafetyCase.draft('s', 't', 'author', 'use', 'high', [], new Date('2026-02-01'), clock);
    expect(safety.validate().ok).toBe(false);
    safety.addControl({ hazard: 'h', mitigation: 'm', evidenceReference: 'e' });
    expect(safety.validate().ok).toBe(true);
    expect(safety.addControl({ hazard: 'late', mitigation: 'm', evidenceReference: 'e' }).ok).toBe(false);
    expect(safety.activate(new Date('2026-03-01')).ok).toBe(false);
    safety.approve('reviewer');
    expect(safety.activate(new Date('2026-03-01')).ok).toBe(false);
    expect(safety.activate(new Date('2026-01-15')).ok).toBe(true);
    safety.suspend();
    expect(safety.state).toBe('suspended');
  });
});

describe('identity lifecycle branches', () => {
  it('requires configuration, activates, suspends, then permits governed deletion request', () => {
    const tenant = Tenant.create('t', 'Legal', 'Display', clock);
    const events = new EventFactory(clock, new UuidGenerator());
    expect(tenant.activate(events, randomUUID(), randomUUID()).ok).toBe(false);
    tenant.configure('eu', { provider: 'saml', issuer: 'issuer', breakGlassAdministratorIds: ['owner'] }, 'key', clock);
    expect(tenant.activate(events, randomUUID(), randomUUID()).ok).toBe(true);
    expect(tenant.configure('us', { provider: 'saml', issuer: 'issuer', breakGlassAdministratorIds: ['owner'] }, 'key', clock).ok).toBe(false);
    expect(tenant.requestDeletion().ok).toBe(false);
    expect(tenant.suspend(events, randomUUID(), randomUUID(), 'security').ok).toBe(true);
    expect(tenant.suspend(events, randomUUID(), randomUUID(), 'again').ok).toBe(false);
    expect(tenant.requestDeletion().ok).toBe(true);
    expect(tenant.pullEvents()).toHaveLength(2);
    expect(tenant.pullEvents()).toHaveLength(0);
  });

  it('protects the final owner and handles membership removal', () => {
    const principal = Principal.provision('p', 't', 'oidc', 'subject', clock);
    principal.grant('tenant-owner', clock);
    expect(principal.revoke('tenant-owner', 0, clock).ok).toBe(false);
    expect(principal.revoke('tenant-owner', 1, clock).ok).toBe(true);
    expect(principal.revoke('missing', 1, clock).ok).toBe(true);
  });
});
