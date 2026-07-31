import { createHash, sign, verify, type KeyLike } from 'node:crypto';

export type RiskTier = 'low' | 'moderate' | 'high' | 'critical';
export type EvidenceLevel = 'local-pass' | 'environment-qualified' | 'external-qualified';
export type ReleaseStage = 'draft' | 'approved' | 'canary' | 'promoted' | 'rolled-back' | 'rejected';

export type EvidenceKind =
  | 'source'
  | 'schemas'
  | 'migrations'
  | 'tenant-isolation'
  | 'prompt-injection'
  | 'poisoned-memory'
  | 'citation-correctness'
  | 'calibration'
  | 'accessibility'
  | 'performance'
  | 'cost-ceiling'
  | 'restore'
  | 'security'
  | 'sbom'
  | 'provenance'
  | 'approval'
  | 'canary';

export interface EvidenceItem {
  readonly kind: EvidenceKind;
  readonly digest: string;
  readonly sourceDigest: string;
  readonly level: EvidenceLevel;
  readonly passed: boolean;
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly issuerKeyId: string;
  readonly signature: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface QualityMetric {
  readonly name: string;
  readonly candidate: number;
  readonly baseline: number;
  readonly direction: 'higher-is-better' | 'lower-is-better';
  readonly maximumRegression: number;
  readonly minimumPracticalBenefit?: number;
  readonly safetyCritical: boolean;
}

export interface AccessibilityEvidence {
  readonly standard: 'WCAG-2.2-AA';
  readonly automatedViolations: number;
  readonly uncertaintyCommunicated: boolean;
  readonly chartAlternativesPresent: boolean;
  readonly keyboardJourneyPassed: boolean;
  readonly screenReaderJourneyPassed: boolean;
  readonly reviewedBy?: string;
}

export interface ReleasePolicy {
  readonly requiredEvidence: Readonly<Record<RiskTier, readonly EvidenceKind[]>>;
  readonly minimumEvidenceLevel: Readonly<Record<RiskTier, EvidenceLevel>>;
  readonly requiredApprovals: Readonly<Record<RiskTier, number>>;
  readonly minimumCanaryObservations: Readonly<Record<RiskTier, number>>;
  readonly maximumCanaryFailureRate: Readonly<Record<RiskTier, number>>;
}

export interface ReleaseApproval {
  readonly releaseId: string;
  readonly riskTier: RiskTier;
  readonly policyDigest: string;
  readonly approverId: string;
  readonly keyId: string;
  readonly role: 'security' | 'privacy' | 'reliability' | 'product' | 'release';
  readonly sourceDigest: string;
  readonly artifactDigest: string;
  readonly approvedAt: string;
  readonly expiresAt: string;
  readonly signature: string;
}

export interface ReleaseGateInput {
  readonly releaseId: string;
  readonly riskTier: RiskTier;
  readonly sourceDigest: string;
  readonly artifactDigest: string;
  readonly priorArtifactDigest: string;
  readonly authorId: string;
  readonly evidence: readonly EvidenceItem[];
  readonly metrics: readonly QualityMetric[];
  readonly accessibility: AccessibilityEvidence;
}

export interface TrustedApprovalSigner {
  readonly principalId: string;
  readonly roles: readonly ReleaseApproval['role'][];
  readonly publicKey: KeyLike;
  readonly revokedAt?: string;
}

export interface ReleaseTrust {
  readonly approvalSigners: ReadonlyMap<string, TrustedApprovalSigner>;
  readonly knownGoodPriorArtifacts: ReadonlySet<string>;
  verifyEvidence(item: EvidenceItem, input: ReleaseGateInput, policyDigest: string): boolean;
}

export interface GateFailure {
  readonly code: string;
  readonly message: string;
  readonly evidenceKind?: EvidenceKind;
}

const levels: Readonly<Record<EvidenceLevel, number>> = {
  'local-pass': 0,
  'environment-qualified': 1,
  'external-qualified': 2,
};

export class ReleaseCandidate {
  public stage: ReleaseStage = 'draft';
  private readonly approvals = new Map<string, ReleaseApproval>();
  private readonly policyDigest: string;
  private canaryObservations = 0;
  private canaryFailures = 0;
  private failures: readonly GateFailure[] = [];

  constructor(
    readonly input: ReleaseGateInput,
    private readonly policy: ReleasePolicy,
    private readonly trust: ReleaseTrust,
  ) {
    validatePolicy(policy);
    this.policyDigest = digestCanonical(policy);
    for (const value of [input.sourceDigest, input.artifactDigest, input.priorArtifactDigest]) {
      if (!isDigest(value)) throw new Error('Release inputs must use SHA-256 digests');
    }
    if (input.artifactDigest === input.priorArtifactDigest) throw new Error('Rollback artifact must differ from candidate');
  }

  evaluate(now = new Date()): readonly GateFailure[] {
    const failures: GateFailure[] = [];
    const required = this.policy.requiredEvidence[this.input.riskTier];
    const minimumLevel = this.policy.minimumEvidenceLevel[this.input.riskTier];
    for (const kind of required) {
      const matching = this.input.evidence.filter((item) => item.kind === kind);
      if (matching.length !== 1) {
        failures.push({ code: 'EVIDENCE_CARDINALITY', message: `Exactly one ${kind} evidence item is required`, evidenceKind: kind });
        continue;
      }
      const item = matching[0]!;
      if (!item.passed || item.sourceDigest !== this.input.sourceDigest || !isDigest(item.digest)
        || !this.trust.verifyEvidence(item, this.input, this.policyDigest)) {
        failures.push({ code: 'EVIDENCE_INVALID', message: `${kind} evidence failed or is not source-bound`, evidenceKind: kind });
      }
      if (levels[item.level] < levels[minimumLevel]) {
        failures.push({ code: 'EVIDENCE_LEVEL', message: `${kind} evidence is below ${minimumLevel}`, evidenceKind: kind });
      }
      if (!validTimestamp(item.createdAt) || Date.parse(item.createdAt) > now.getTime()
        || item.expiresAt === undefined || !validTimestamp(item.expiresAt) || Date.parse(item.expiresAt) <= now.getTime()) {
        failures.push({ code: 'EVIDENCE_STALE', message: `${kind} evidence is invalid or expired`, evidenceKind: kind });
      }
    }
    failures.push(...evaluateMetrics(this.input.metrics));
    failures.push(...evaluateAccessibility(this.input.accessibility));
    this.failures = Object.freeze(failures);
    if (failures.length > 0) this.stage = 'rejected';
    return this.failures;
  }

  addApproval(approval: ReleaseApproval, now = new Date()): boolean {
    if (this.stage !== 'draft' || approval.approverId === this.input.authorId
      || approval.releaseId !== this.input.releaseId || approval.riskTier !== this.input.riskTier
      || approval.policyDigest !== this.policyDigest || approval.keyId.trim().length === 0
      || approval.sourceDigest !== this.input.sourceDigest || approval.artifactDigest !== this.input.artifactDigest
      || !validTimestamp(approval.approvedAt) || !validTimestamp(approval.expiresAt)
      || Date.parse(approval.approvedAt) > now.getTime() || Date.parse(approval.expiresAt) <= now.getTime()
      || !this.verifyApproval(approval)) return false;
    this.approvals.set(approval.approverId, Object.freeze({ ...approval }));
    return true;
  }

  approve(now = new Date()): readonly GateFailure[] {
    const failures = [...this.evaluate(now)];
    for (const [id, approval] of this.approvals) {
      if (!this.approvalIsTrusted(approval, now)) this.approvals.delete(id);
    }
    const required = this.policy.requiredApprovals[this.input.riskTier];
    const roles = new Set([...this.approvals.values()].map(({ role }) => role));
    if (this.approvals.size < required || (this.input.riskTier === 'critical' && !roles.has('security'))) {
      failures.push({ code: 'APPROVAL_REQUIRED', message: `${required} independent approvals and required roles are needed` });
    }
    if (failures.length === 0) this.stage = 'approved';
    else this.stage = 'rejected';
    this.failures = Object.freeze(failures);
    return this.failures;
  }

  startCanary(): boolean {
    if (this.stage !== 'approved' || !this.trust.knownGoodPriorArtifacts.has(this.input.priorArtifactDigest)) return false;
    this.stage = 'canary';
    return true;
  }

  observeCanary(failed: boolean): ReleaseStage {
    if (this.stage !== 'canary') return this.stage;
    this.canaryObservations += 1;
    if (failed) this.canaryFailures += 1;
    const failureRate = this.canaryFailures / this.canaryObservations;
    if (failureRate > this.policy.maximumCanaryFailureRate[this.input.riskTier]) {
      this.stage = 'rolled-back';
    } else if (this.canaryObservations >= this.policy.minimumCanaryObservations[this.input.riskTier]) {
      this.stage = 'promoted';
    }
    return this.stage;
  }

  rollbackTarget(): string | undefined {
    return this.stage === 'rolled-back' ? this.input.priorArtifactDigest : undefined;
  }

  receipt(): Readonly<Record<string, unknown>> {
    const body = {
      schemaVersion: 1,
      releaseId: this.input.releaseId,
      riskTier: this.input.riskTier,
      policyDigest: this.policyDigest,
      sourceDigest: this.input.sourceDigest,
      artifactDigest: this.input.artifactDigest,
      priorArtifactDigest: this.input.priorArtifactDigest,
      stage: this.stage,
      evidenceDigests: this.input.evidence.map(({ kind, digest }) => ({ kind, digest })),
      evidence: this.input.evidence.map(({ kind, digest, level, passed, createdAt, expiresAt, issuerKeyId }) => ({
        kind, digest, level, passed, createdAt, expiresAt, issuerKeyId,
      })),
      approvals: [...this.approvals.values()].map(({ signature: _signature, ...approval }) => ({
        ...approval, approvalDigest: digestCanonical(approval),
      })),
      metrics: this.input.metrics,
      accessibility: this.input.accessibility,
      failures: this.failures,
      canary: { observations: this.canaryObservations, failures: this.canaryFailures },
    };
    return Object.freeze({ ...body, receiptDigest: digestCanonical(body) });
  }

  private verifyApproval(approval: ReleaseApproval): boolean {
    const signer = this.trust.approvalSigners.get(approval.keyId);
    if (signer === undefined || signer.principalId !== approval.approverId || !signer.roles.includes(approval.role)) return false;
    try {
      return verify(null, Buffer.from(approvalPayload(approval)), signer.publicKey, Buffer.from(approval.signature, 'base64'));
    } catch {
      return false;
    }
  }

  private approvalIsTrusted(approval: ReleaseApproval, now: Date): boolean {
    const signer = this.trust.approvalSigners.get(approval.keyId);
    return signer !== undefined && signer.principalId === approval.approverId
      && signer.roles.includes(approval.role)
      && (signer.revokedAt === undefined || Date.parse(signer.revokedAt) > now.getTime())
      && Date.parse(approval.approvedAt) <= now.getTime() && Date.parse(approval.expiresAt) > now.getTime()
      && this.verifyApproval(approval);
  }
}

export function signApproval(
  approval: Omit<ReleaseApproval, 'signature'>,
  privateKey: KeyLike,
): ReleaseApproval {
  return Object.freeze({
    ...approval,
    signature: sign(null, Buffer.from(approvalPayload(approval)), privateKey).toString('base64'),
  });
}

export function digestCanonical(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function evaluateMetrics(metrics: readonly QualityMetric[]): GateFailure[] {
  const failures: GateFailure[] = [];
  const names = new Set<string>();
  for (const metric of metrics) {
    if (names.has(metric.name) || !Number.isFinite(metric.candidate) || !Number.isFinite(metric.baseline)
      || metric.maximumRegression < 0) {
      failures.push({ code: 'METRIC_INVALID', message: `Metric ${metric.name} is invalid or duplicated` });
      continue;
    }
    names.add(metric.name);
    const improvement = metric.direction === 'higher-is-better'
      ? metric.candidate - metric.baseline
      : metric.baseline - metric.candidate;
    if (improvement < -metric.maximumRegression) {
      failures.push({ code: 'METRIC_REGRESSION', message: `${metric.name} exceeds its regression budget` });
    }
    if (metric.minimumPracticalBenefit !== undefined && improvement < metric.minimumPracticalBenefit) {
      failures.push({ code: 'BENEFIT_NOT_MEANINGFUL', message: `${metric.name} lacks required practical benefit` });
    }
    if (metric.safetyCritical && improvement < 0) {
      failures.push({ code: 'SAFETY_REGRESSION', message: `${metric.name} is safety-critical and cannot regress` });
    }
  }
  return failures;
}

function evaluateAccessibility(value: AccessibilityEvidence): GateFailure[] {
  if (value.standard !== 'WCAG-2.2-AA' || value.automatedViolations !== 0
    || !value.uncertaintyCommunicated || !value.chartAlternativesPresent
    || !value.keyboardJourneyPassed || !value.screenReaderJourneyPassed || value.reviewedBy === undefined) {
    return [{ code: 'ACCESSIBILITY_FAILED', message: 'WCAG 2.2 AA automated and assisted review evidence is incomplete' }];
  }
  return [];
}

function approvalPayload(approval: Omit<ReleaseApproval, 'signature'> | ReleaseApproval): string {
  return canonical({
    approverId: approval.approverId,
    releaseId: approval.releaseId,
    riskTier: approval.riskTier,
    policyDigest: approval.policyDigest,
    keyId: approval.keyId,
    role: approval.role,
    sourceDigest: approval.sourceDigest,
    artifactDigest: approval.artifactDigest,
    approvedAt: approval.approvedAt,
    expiresAt: approval.expiresAt,
  });
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}

function isDigest(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function validTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function validatePolicy(policy: ReleasePolicy): void {
  const allKinds: readonly EvidenceKind[] = [
    'source', 'schemas', 'migrations', 'tenant-isolation', 'prompt-injection', 'poisoned-memory',
    'citation-correctness', 'calibration', 'accessibility', 'performance', 'cost-ceiling', 'restore',
    'security', 'sbom', 'provenance', 'approval', 'canary',
  ];
  for (const tier of ['low', 'moderate', 'high', 'critical'] as const) {
    if (new Set(policy.requiredEvidence[tier]).size !== allKinds.length
      || allKinds.some((kind) => !policy.requiredEvidence[tier].includes(kind))
      || !Number.isSafeInteger(policy.requiredApprovals[tier]) || policy.requiredApprovals[tier] < 1
      || !Number.isSafeInteger(policy.minimumCanaryObservations[tier]) || policy.minimumCanaryObservations[tier] < 1
      || !Number.isFinite(policy.maximumCanaryFailureRate[tier])
      || policy.maximumCanaryFailureRate[tier] < 0 || policy.maximumCanaryFailureRate[tier] > 0.1) {
      throw new Error(`Release policy weakens mandatory Prompt 18 controls for ${tier}`);
    }
  }
}
