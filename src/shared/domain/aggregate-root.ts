import type { DomainEventEnvelope } from '../contracts/envelopes.js';

export abstract class AggregateRoot {
  private pendingEvents: DomainEventEnvelope[] = [];

  protected constructor(
    readonly id: string,
    readonly tenantId: string,
    public version: number,
    readonly createdAt: Date,
    public updatedAt: Date,
  ) {}

  protected raise(event: DomainEventEnvelope): void {
    this.pendingEvents.push(event);
  }

  pullEvents(): readonly DomainEventEnvelope[] {
    const events = this.pendingEvents;
    this.pendingEvents = [];
    return events;
  }
}
