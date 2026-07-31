import { AggregateRoot, type Clock, type Result, invariant } from '../../../shared/domain/index.js';
import type { ArtifactReference } from '../../../platform/persistence/index.js';

export type EpistemicClass =
  | 'observed-fact'
  | 'user-assertion'
  | 'external-claim'
  | 'estimate'
  | 'assumption'
  | 'model-inference'
  | 'simulated-result';

export type Sensitivity = 'public' | 'internal' | 'confidential' | 'restricted';
export type VerificationStatus = 'unverified' | 'verified' | 'disputed';

export interface ProvenanceLink {
  readonly kind: 'source' | 'derived-from' | 'model' | 'tool' | 'verifier';
  readonly reference: string;
  readonly version?: string;
}

export interface EvidenceClaim {
  readonly id: string;
  readonly text: string;
  readonly sourceSpan?: string;
  readonly status: VerificationStatus;
  readonly verifierReference?: string;
}

export class EvidenceRecord extends AggregateRoot {
  public verificationStatus: VerificationStatus = 'unverified';
  public staleAt?: Date;
  public supersededBy?: string;
  private readonly claims = new Map<string, EvidenceClaim>();

  private constructor(
    id: string,
    tenantId: string,
    now: Date,
    readonly artifact: ArtifactReference,
    readonly sourceLocator: string,
    readonly capturedAt: Date,
    public epistemicClass: EpistemicClass,
    public sensitivity: Sensitivity,
    readonly purposes: ReadonlySet<string>,
    readonly retentionPolicyId: string,
    readonly provenance: readonly ProvenanceLink[],
  ) {
    super(id, tenantId, 0, now, now);
  }

  static ingest(input: {
    id: string;
    tenantId: string;
    artifact: ArtifactReference;
    sourceLocator: string;
    capturedAt: Date;
    epistemicClass: EpistemicClass;
    sensitivity: Sensitivity;
    purposes: readonly string[];
    retentionPolicyId: string;
    provenance: readonly ProvenanceLink[];
  }, clock: Clock): Result<EvidenceRecord> {
    if (input.purposes.length === 0 || input.provenance.length === 0 || input.sourceLocator.length === 0) {
      return { ok: false, error: invariant('Source, purpose, and provenance are mandatory') };
    }
    return {
      ok: true,
      value: new EvidenceRecord(
        input.id,
        input.tenantId,
        clock.now(),
        input.artifact,
        input.sourceLocator,
        input.capturedAt,
        input.epistemicClass,
        input.sensitivity,
        new Set(input.purposes),
        input.retentionPolicyId,
        Object.freeze([...input.provenance]),
      ),
    };
  }

  addClaim(claim: EvidenceClaim): Result<EvidenceRecord> {
    if (this.claims.has(claim.id)) return { ok: false, error: invariant('Claim IDs are unique') };
    this.claims.set(claim.id, Object.freeze({ ...claim }));
    return { ok: true, value: this };
  }

  verify(verifierReference: string, qualifying: boolean): Result<EvidenceRecord> {
    if (!qualifying || this.provenance.length === 0 || verifierReference.length === 0) {
      return { ok: false, error: invariant('Qualifying verifier and provenance required') };
    }
    this.verificationStatus = 'verified';
    return { ok: true, value: this };
  }

  reclassify(next: EpistemicClass, governanceApprovalReference?: string): Result<EvidenceRecord> {
    const generated = new Set<EpistemicClass>(['estimate', 'assumption', 'model-inference', 'simulated-result']);
    if (next === 'observed-fact' && generated.has(this.epistemicClass)) {
      return { ok: false, error: invariant('Generated or simulated content can never become observed fact') };
    }
    if (next === 'observed-fact' && governanceApprovalReference === undefined) {
      return { ok: false, error: { code: 'OBLIGATION_REQUIRED', message: 'Governance approval is required' } };
    }
    this.epistemicClass = next;
    return { ok: true, value: this };
  }

  restrict(next: Sensitivity): Result<EvidenceRecord> {
    const order: Record<Sensitivity, number> = { public: 0, internal: 1, confidential: 2, restricted: 3 };
    if (order[next] < order[this.sensitivity]) {
      return { ok: false, error: { code: 'OBLIGATION_REQUIRED', message: 'Governance approval required to reduce restriction' } };
    }
    this.sensitivity = next;
    return { ok: true, value: this };
  }

  supersede(nextId: string, ancestorIds: ReadonlySet<string>): Result<EvidenceRecord> {
    if (nextId === this.id || ancestorIds.has(nextId)) return { ok: false, error: invariant('Supersession must be acyclic') };
    if (this.supersededBy !== undefined && this.supersededBy !== nextId) {
      return { ok: false, error: invariant('Evidence is already superseded') };
    }
    this.supersededBy = nextId;
    return { ok: true, value: this };
  }

  permits(purpose: string): boolean {
    return this.purposes.has(purpose);
  }

  snapshot(): Readonly<Record<string, unknown>> {
    return Object.freeze({
      id: this.id,
      version: this.version,
      contentHash: this.artifact.contentHash,
      epistemicClass: this.epistemicClass,
      sensitivity: this.sensitivity,
      provenance: this.provenance,
      claims: [...this.claims.values()],
      verificationStatus: this.verificationStatus,
    });
  }
}
