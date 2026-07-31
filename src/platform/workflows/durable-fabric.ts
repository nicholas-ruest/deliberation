import type { Result } from '../../shared/domain/result.js';

export interface QueueEnvelope {
  readonly eventId: string;
  readonly tenantId: string;
  readonly workflowId: string;
  readonly generation: number;
  readonly schemaVersion: number;
  readonly payload: unknown;
}

export interface QueueDelivery {
  readonly receipt: string;
  readonly envelope: QueueEnvelope;
}

export interface QueueTransport {
  publish(envelope: QueueEnvelope): Promise<void>;
  receive(maximum: number): Promise<readonly QueueDelivery[]>;
  ack(receipt: string): Promise<void>;
  nack(receipt: string, retryAt: Date): Promise<void>;
}

export class DurableInbox {
  private readonly accepted = new Set<string>();

  accept(envelope: QueueEnvelope, expectedGeneration: number): Result<void> {
    if (envelope.generation !== expectedGeneration) {
      return { ok: false, error: { code: 'VERSION_CONFLICT', message: 'Stale workflow generation fenced' } };
    }
    const key = `${envelope.tenantId}:${envelope.eventId}`;
    if (this.accepted.has(key)) return { ok: true, value: undefined };
    this.accepted.add(key);
    return { ok: true, value: undefined };
  }
}

export class TenantFairScheduler {
  private cursor = 0;

  select(deliveries: readonly QueueDelivery[], maximum: number): readonly QueueDelivery[] {
    const groups = new Map<string, QueueDelivery[]>();
    for (const delivery of deliveries) {
      const group = groups.get(delivery.envelope.tenantId) ?? [];
      group.push(delivery);
      groups.set(delivery.envelope.tenantId, group);
    }
    const tenants = [...groups.keys()].sort();
    if (tenants.length === 0) return [];
    const selected: QueueDelivery[] = [];
    const offsets = new Map(tenants.map((tenant) => [tenant, 0]));
    let active = tenants.length;
    while (selected.length < maximum && active > 0) {
      const tenant = tenants[this.cursor % tenants.length]!;
      this.cursor = (this.cursor + 1) % tenants.length;
      const queue = groups.get(tenant)!;
      const offset = offsets.get(tenant)!;
      const delivery = queue[offset];
      if (delivery !== undefined) {
        selected.push(delivery);
        offsets.set(tenant, offset + 1);
        if (offset + 1 === queue.length) active -= 1;
      }
    }
    return selected;
  }
}
