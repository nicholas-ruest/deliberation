import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import {
  ReleaseCandidate,
  digestCanonical,
  signApproval,
  type EvidenceItem,
  type ReleaseGateInput,
  type ReleasePolicy,
  type ReleaseTrust,
} from '../../src/platform/release/index.js';

const digest = (value: string) => digestCanonical(value);
const sourceDigest = digest('source');
const artifactDigest = digest('artifact');
const priorArtifactDigest = digest('prior');
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const kinds = [
  'source', 'schemas', 'migrations', 'tenant-isolation', 'prompt-injection', 'poisoned-memory',
  'citation-correctness', 'calibration', 'accessibility', 'performance', 'cost-ceiling', 'restore',
  'security', 'sbom', 'provenance', 'approval', 'canary',
] as const;
const policy: ReleasePolicy = {
  requiredEvidence: { low: kinds, moderate: kinds, high: kinds, critical: kinds },
  minimumEvidenceLevel: {
    low: 'local-pass', moderate: 'environment-qualified', high: 'external-qualified', critical: 'external-qualified',
  },
  requiredApprovals: { low: 1, moderate: 2, high: 3, critical: 4 },
  minimumCanaryObservations: { low: 2, moderate: 2, high: 2, critical: 2 },
  maximumCanaryFailureRate: { low: 0.1, moderate: 0.1, high: 0.1, critical: 0.1 },
};
const evidence: EvidenceItem[] = kinds.map((kind) => ({
  kind,
  digest: digest(kind),
  sourceDigest,
  level: 'external-qualified',
  passed: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2027-01-01T00:00:00.000Z',
  issuerKeyId: 'ci-attestor',
  signature: 'fixture-attestation',
}));
const input: ReleaseGateInput = {
  releaseId: 'release-1',
  riskTier: 'high',
  sourceDigest,
  artifactDigest,
  priorArtifactDigest,
  authorId: 'author',
  evidence,
  metrics: [
    {
      name: 'citation-correctness', candidate: 0.99, baseline: 0.98, direction: 'higher-is-better',
      maximumRegression: 0, minimumPracticalBenefit: 0.005, safetyCritical: true,
    },
    {
      name: 'p95-latency-ms', candidate: 90, baseline: 100, direction: 'lower-is-better',
      maximumRegression: 5, minimumPracticalBenefit: 5, safetyCritical: false,
    },
  ],
  accessibility: {
    standard: 'WCAG-2.2-AA', automatedViolations: 0, uncertaintyCommunicated: true,
    chartAlternativesPresent: true, keyboardJourneyPassed: true, screenReaderJourneyPassed: true,
    reviewedBy: 'accessibility-reviewer',
  },
};
const signer = (principalId: string, roles: readonly ('security' | 'privacy' | 'reliability')[]) => ({
  principalId, roles, publicKey,
});
const trust: ReleaseTrust = {
  approvalSigners: new Map([
    ['security-key', signer('security-reviewer', ['security'])],
    ['privacy-key', signer('privacy-reviewer', ['privacy'])],
    ['reliability-key', signer('reliability-reviewer', ['reliability'])],
    ['reviewer-key', signer('reviewer', ['security'])],
  ]),
  knownGoodPriorArtifacts: new Set([priorArtifactDigest]),
  verifyEvidence: (item) => item.issuerKeyId === 'ci-attestor' && item.signature === 'fixture-attestation',
};

function approval(
  approverId: string,
  role: 'security' | 'privacy' | 'reliability',
  riskTier: 'low' | 'high' = 'high',
) {
  return signApproval({
    releaseId: 'release-1', riskTier, policyDigest: digestCanonical(policy),
    approverId, keyId: `${approverId.replace(/-reviewer$/, '')}-key`, role, sourceDigest, artifactDigest,
    approvedAt: '2026-01-02T00:00:00.000Z', expiresAt: '2027-01-01T00:00:00.000Z',
  }, privateKey);
}

describe('evidence-based release gate', () => {
  it('requires source-bound qualified evidence and independent signed approvals', () => {
    const candidate = new ReleaseCandidate(input, policy, trust);
    expect(candidate.addApproval(approval('security-reviewer', 'security'), new Date('2026-06-01'))).toBe(true);
    expect(candidate.addApproval(approval('privacy-reviewer', 'privacy'), new Date('2026-06-01'))).toBe(true);
    expect(candidate.addApproval(approval('reliability-reviewer', 'reliability'), new Date('2026-06-01'))).toBe(true);
    expect(candidate.approve(new Date('2026-06-01'))).toEqual([]);
    expect(candidate.stage).toBe('approved');
    expect(candidate.startCanary()).toBe(true);
    expect(candidate.observeCanary(false)).toBe('canary');
    expect(candidate.observeCanary(false)).toBe('promoted');
    expect(candidate.receipt()).toMatchObject({ stage: 'promoted', sourceDigest, artifactDigest });
  });

  it('fails closed for missing, stale, low-level, duplicated, or cross-source evidence', () => {
    const broken = evidence.map((item) => item.kind === 'security'
      ? { ...item, sourceDigest: digest('other'), level: 'local-pass' as const }
      : item).filter(({ kind }) => kind !== 'restore');
    const candidate = new ReleaseCandidate({ ...input, evidence: [...broken, broken[0]!] }, policy, trust);
    const failures = candidate.evaluate(new Date('2026-06-01'));
    expect(failures.map(({ code }) => code)).toEqual(expect.arrayContaining([
      'EVIDENCE_INVALID', 'EVIDENCE_LEVEL', 'EVIDENCE_CARDINALITY',
    ]));
    expect(candidate.stage).toBe('rejected');
    expect(candidate.startCanary()).toBe(false);
  });

  it('rejects forged/self approvals and rolls a failed canary back to the signed prior digest', () => {
    const lowInput = { ...input, riskTier: 'low' as const };
    const candidate = new ReleaseCandidate(lowInput, policy, trust);
    const lowApproval = approval('reviewer', 'security', 'low');
    expect(candidate.addApproval({ ...lowApproval, approverId: 'author' }, new Date('2026-06-01'))).toBe(false);
    expect(candidate.addApproval({ ...lowApproval, signature: 'invalid' }, new Date('2026-06-01'))).toBe(false);
    expect(candidate.addApproval(lowApproval, new Date('2026-06-01'))).toBe(true);
    expect(candidate.approve(new Date('2026-06-01'))).toEqual([]);
    candidate.startCanary();
    expect(candidate.observeCanary(true)).toBe('rolled-back');
    expect(candidate.rollbackTarget()).toBe(priorArtifactDigest);
  });

  it('rejects signer identity forgery, unauthenticated evidence, and identical rollback artifacts', () => {
    const forged = signApproval({
      ...approval('security-reviewer', 'security'),
      approverId: 'privacy-reviewer',
      keyId: 'security-key',
    }, privateKey);
    const candidate = new ReleaseCandidate(input, policy, trust);
    expect(candidate.addApproval(forged, new Date('2026-06-01'))).toBe(false);
    const unauthenticated = new ReleaseCandidate({
      ...input,
      evidence: evidence.map((item) => item.kind === 'security' ? { ...item, signature: 'forged' } : item),
    }, policy, trust);
    expect(unauthenticated.evaluate(new Date('2026-06-01')).map(({ code }) => code)).toContain('EVIDENCE_INVALID');
    expect(() => new ReleaseCandidate({
      ...input, priorArtifactDigest: artifactDigest,
    }, policy, trust)).toThrow('Rollback artifact must differ');
  });

  it('blocks safety regression, negligible benefit, and incomplete accessibility evidence', () => {
    const candidate = new ReleaseCandidate({
      ...input,
      metrics: [{
        name: 'calibration', candidate: 0.7, baseline: 0.8, direction: 'higher-is-better',
        maximumRegression: 0.2, minimumPracticalBenefit: 0.01, safetyCritical: true,
      }],
      accessibility: { ...input.accessibility, chartAlternativesPresent: false },
    }, policy, trust);
    expect(candidate.evaluate().map(({ code }) => code)).toEqual(expect.arrayContaining([
      'SAFETY_REGRESSION', 'BENEFIT_NOT_MEANINGFUL', 'ACCESSIBILITY_FAILED',
    ]));
  });
});
