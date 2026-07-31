import { createHash } from 'node:crypto';
import { AggregateRoot, type Clock, type Result, invariant } from '../../../shared/domain/index.js';

export interface MaterialClaim {
  readonly text: string;
  readonly evidenceReferences: readonly string[];
}

export interface BriefContent {
  readonly eligibleOptions: readonly string[];
  readonly paretoOptions: readonly string[];
  readonly assumptions: readonly string[];
  readonly materialClaims: readonly MaterialClaim[];
  readonly dissent: readonly string[];
  readonly sensitivitySummary: string;
  readonly limitations: readonly string[];
  readonly callToAction: string;
  readonly abstention?: { readonly reasons: readonly string[]; readonly unblockConditions: readonly string[] };
}

export class DecisionBrief extends AggregateRoot {
  public state: 'draft' | 'published' | 'superseded' = 'draft';
  public contentHash?: string;
  public supersededBy?: string;

  private constructor(
    id: string,
    tenantId: string,
    now: Date,
    readonly evaluationRunId: string,
    readonly content: BriefContent,
  ) {
    super(id, tenantId, 0, now, now);
  }

  static compose(id: string, tenantId: string, evaluationRunId: string, content: BriefContent, clock: Clock): Result<DecisionBrief> {
    if (content.materialClaims.some(({ evidenceReferences }) => evidenceReferences.length === 0)) {
      return { ok: false, error: invariant('Every material claim requires a citation') };
    }
    if (content.abstention !== undefined && content.eligibleOptions.length > 0) {
      return { ok: false, error: invariant('Abstaining brief cannot select eligible winners') };
    }
    if (/platform (made|decided|chose)/i.test(content.callToAction)) {
      return { ok: false, error: invariant('Brief must preserve human decision authority') };
    }
    return { ok: true, value: new DecisionBrief(id, tenantId, clock.now(), evaluationRunId, deepFreeze(content)) };
  }

  publish(): Result<DecisionBrief> {
    if (this.state !== 'draft') return { ok: false, error: invariant('Only draft brief can publish') };
    this.contentHash = createHash('sha256').update(JSON.stringify(this.content)).digest('hex');
    this.state = 'published';
    return { ok: true, value: this };
  }

  supersede(nextId: string): Result<DecisionBrief> {
    if (this.state !== 'published' || nextId === this.id) return { ok: false, error: invariant('Published brief requires a distinct successor') };
    this.state = 'superseded';
    this.supersededBy = nextId;
    return { ok: true, value: this };
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  }
  return value;
}
