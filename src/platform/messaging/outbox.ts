import type { DomainEventEnvelope } from '../../shared/contracts/index.js';

export interface OutboxRecord {
  readonly event: DomainEventEnvelope;
  readonly recordedAt: Date;
  publishedAt?: Date;
  attempts: number;
}

export interface OutboxStore {
  append(events: readonly DomainEventEnvelope[]): Promise<void>;
  pending(limit: number): Promise<readonly OutboxRecord[]>;
  markPublished(eventId: string, at: Date): Promise<void>;
}

export class InMemoryOutbox implements OutboxStore {
  private readonly records = new Map<string, OutboxRecord>();

  async append(events: readonly DomainEventEnvelope[]): Promise<void> {
    for (const event of events) {
      if (!this.records.has(event.eventId)) {
        this.records.set(event.eventId, { event, recordedAt: new Date(event.recordedAt), attempts: 0 });
      }
    }
  }

  async pending(limit: number): Promise<readonly OutboxRecord[]> {
    return [...this.records.values()]
      .filter(({ publishedAt }) => publishedAt === undefined)
      .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime())
      .slice(0, limit);
  }

  async markPublished(eventId: string, at: Date): Promise<void> {
    const record = this.records.get(eventId);
    if (record !== undefined) {
      record.publishedAt = at;
      record.attempts += 1;
    }
  }
}

export class Inbox {
  private readonly processed = new Set<string>();

  async once(consumer: string, eventId: string, handler: () => Promise<void>): Promise<boolean> {
    const key = `${consumer}:${eventId}`;
    if (this.processed.has(key)) return false;
    await handler();
    this.processed.add(key);
    return true;
  }
}

export interface EventTransport {
  publish(event: DomainEventEnvelope): Promise<void>;
}

export async function relayOutbox(
  outbox: OutboxStore,
  transport: EventTransport,
  now: Date,
  limit = 100,
): Promise<number> {
  let published = 0;
  for (const record of await outbox.pending(limit)) {
    await transport.publish(record.event);
    await outbox.markPublished(record.event.eventId, now);
    published += 1;
  }
  return published;
}
