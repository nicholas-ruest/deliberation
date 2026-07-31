import { createHash, createHmac } from 'node:crypto';

export interface AuditRecordInput {
  readonly tenantId: string;
  readonly actorId: string;
  readonly action: string;
  readonly resourceReference: string;
  readonly outcome: 'allowed' | 'denied' | 'failed' | 'succeeded';
  readonly reasonCode: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly policyVersion?: string;
  readonly artifactDigest?: string;
  readonly occurredAt: Date;
}

export interface AuditRecord extends AuditRecordInput {
  readonly sequence: number;
  readonly previousHash: string;
  readonly recordHash: string;
}

export interface AuditAnchor {
  readonly tenantId: string;
  readonly sequence: number;
  readonly rootHash: string;
  readonly signature: string;
}

export class TamperEvidentAuditLedger {
  private readonly partitions = new Map<string, AuditRecord[]>();

  constructor(private readonly signingKey: Uint8Array) {}

  append(input: AuditRecordInput): AuditRecord {
    const records = this.partitions.get(input.tenantId) ?? [];
    const previousHash = records.at(-1)?.recordHash ?? 'GENESIS';
    const sequence = records.length + 1;
    const canonical = JSON.stringify({ ...input, occurredAt: input.occurredAt.toISOString(), sequence, previousHash });
    const record = Object.freeze({
      ...input,
      sequence,
      previousHash,
      recordHash: createHash('sha256').update(canonical).digest('hex'),
    });
    records.push(record);
    this.partitions.set(input.tenantId, records);
    return record;
  }

  verify(tenantId: string): boolean {
    let previousHash = 'GENESIS';
    for (const record of this.partitions.get(tenantId) ?? []) {
      const { recordHash, ...content } = record;
      const canonical = JSON.stringify({ ...content, occurredAt: record.occurredAt.toISOString() });
      if (record.previousHash !== previousHash || createHash('sha256').update(canonical).digest('hex') !== recordHash) return false;
      previousHash = recordHash;
    }
    return true;
  }

  anchor(tenantId: string): AuditAnchor {
    const records = this.partitions.get(tenantId) ?? [];
    const sequence = records.length;
    const rootHash = records.at(-1)?.recordHash ?? 'GENESIS';
    const signature = createHmac('sha256', this.signingKey).update(`${tenantId}:${sequence}:${rootHash}`).digest('hex');
    return Object.freeze({ tenantId, sequence, rootHash, signature });
  }

  export(tenantId: string): readonly AuditRecord[] {
    return Object.freeze([...(this.partitions.get(tenantId) ?? [])]);
  }
}
