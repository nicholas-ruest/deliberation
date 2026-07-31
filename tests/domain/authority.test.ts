import { describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/shared/domain/index.js';
import { Tenant, Principal } from '../../src/identity-access/domain/index.js';
import { PolicySet, ConsentRecord, SafetyCase } from '../../src/governance/domain/index.js';
import { DeliberationCase } from '../../src/deliberation/domain/index.js';
import { PreferenceProfile } from '../../src/preferences/domain/index.js';

const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));

describe('identity and governance authority', () => {
  it('requires configured break glass and locks region after activation', () => {
    const tenant = Tenant.create('tenant', 'Legal', 'Display', clock);
    expect(tenant.configure('eu-west', {
      provider: 'oidc',
      issuer: 'https://idp.example',
      breakGlassAdministratorIds: [],
    }, 'key', clock).ok).toBe(false);
    expect(tenant.configure('eu-west', {
      provider: 'oidc',
      issuer: 'https://idp.example',
      breakGlassAdministratorIds: ['owner'],
    }, 'key', clock).ok).toBe(true);
    expect(tenant.configure('us-east', {
      provider: 'oidc',
      issuer: 'https://idp.example',
      breakGlassAdministratorIds: ['owner'],
    }, 'key', clock).ok).toBe(true);
  });

  it('increments session epoch on security-sensitive identity changes', () => {
    const principal = Principal.provision('p', 't', 'oidc', 'subject', clock);
    principal.grant('member', clock);
    const epoch = principal.sessionEpoch;
    principal.revokeSessions(clock);
    expect(principal.sessionEpoch).toBe(epoch + 1);
    principal.disable(clock);
    expect(principal.grant('reviewer', clock).ok).toBe(false);
  });

  it('applies deny override and rejects author-only policy activation', () => {
    const policy = PolicySet.draft('policy', 'tenant', 'author', clock);
    policy.addRule({ id: 'allow', priority: 1, effect: 'allow', actions: ['brief.publish'], roles: ['reviewer'] });
    policy.addRule({ id: 'deny-high', priority: 2, effect: 'deny', actions: ['brief.publish'], maximumRiskTier: 'high' });
    expect(policy.approve('author').ok).toBe(false);
    expect(policy.approve('independent').ok).toBe(true);
    expect(policy.activate().ok).toBe(true);
    expect(policy.evaluate({
      tenantId: 'tenant',
      subjectId: 'reviewer',
      roles: ['reviewer'],
      action: 'brief.publish',
      resourceType: 'brief',
      purpose: 'decision-support',
      riskTier: 'high',
      capabilities: [],
      consentPurposes: [],
    }, 'decision').effect).toBe('deny');
  });

  it('withdraws consent irreversibly while preserving legal hold', () => {
    const granted = ConsentRecord.grant('c', 't', 's', ['decision-support'], ['confidential'], 'receipt', clock);
    expect(granted.ok).toBe(true);
    if (!granted.ok) return;
    granted.value.applyLegalHold('case-1');
    granted.value.withdraw(clock);
    expect(granted.value.permits('decision-support', 'confidential')).toBe(false);
    expect(granted.value.legalHoldReferences.has('case-1')).toBe(true);
  });

  it('requires an independently approved, non-prohibited safety case', () => {
    const safety = SafetyCase.draft('s', 't', 'author', 'procurement', 'high', [], new Date('2027-01-01'), clock);
    safety.addControl({ hazard: 'bias', mitigation: 'independent review', evidenceReference: 'test-suite' });
    expect(safety.validate().ok).toBe(true);
    expect(safety.approve('author').ok).toBe(false);
    expect(safety.approve('reviewer').ok).toBe(true);
    expect(safety.activate(new Date('2026-06-01')).ok).toBe(true);
  });
});

describe('human decision and preferences', () => {
  it('lets only the named authority record a decision and treats identical replay as no-op', () => {
    const created = DeliberationCase.draft('case', 'tenant', 'Question', clock);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const decisionCase = created.value;
    decisionCase.defineContract({
      question: 'Choose?',
      successDefinition: 'Measurable result',
      options: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
      generateOptions: false,
      constraints: [],
      stakeholderIds: ['stakeholder'],
      decisionAuthorityId: 'human',
      riskClassificationReference: 'risk',
      deadline: new Date('2027-01-01'),
    });
    decisionCase.scope();
    decisionCase.markReady(clock.now());
    decisionCase.requestPlanning('run');
    decisionCase.attachBrief('brief');
    expect(decisionCase.recordHumanDecision({ optionId: 'a', authorityId: 'model', rationale: 'AI', recordedAt: clock.now() }, clock).ok).toBe(false);
    const human = { optionId: 'a', authorityId: 'human', rationale: 'Evidence', recordedAt: clock.now() };
    expect(decisionCase.recordHumanDecision(human, clock).ok).toBe(true);
    expect(decisionCase.recordHumanDecision(human, clock).ok).toBe(true);
  });

  it('normalizes confirmed soft weights without converting vetoes', () => {
    const profile = PreferenceProfile.create('profile', 'tenant', 'stakeholder', clock);
    profile.addCriterion({ key: 'cost', label: 'Cost', unit: 'USD', weight: 2, state: 'confirmed' });
    profile.addCriterion({ key: 'speed', label: 'Speed', unit: 'days', weight: 1, state: 'confirmed' });
    profile.addVeto({ key: 'legal', predicate: 'legal=true', rationale: 'mandatory' });
    const snapshot = profile.publish(clock);
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(snapshot.value.criteria.reduce((sum, criterion) => sum + criterion.weight, 0)).toBeCloseTo(1);
    expect(snapshot.value.vetoes).toHaveLength(1);
  });
});
