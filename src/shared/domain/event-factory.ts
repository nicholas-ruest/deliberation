import type { Clock } from './clock.js';
import type { IdGenerator } from './ids.js';
import type { DomainEventEnvelope } from '../contracts/envelopes.js';

export interface EventContext {
  readonly tenantId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly actorId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly purpose: string;
  readonly policyDecisionRef?: string;
  readonly dataClassification?: 'public' | 'internal' | 'confidential' | 'restricted';
}

export class EventFactory {
  constructor(
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  create<T extends Readonly<Record<string, unknown>>>(
    eventType: string,
    context: EventContext,
    payload: T,
  ): DomainEventEnvelope<T> {
    const instant = this.clock.now().toISOString();
    return {
      eventId: this.ids.next(),
      eventType,
      schemaVersion: 1,
      tenantId: context.tenantId,
      aggregateType: context.aggregateType,
      aggregateId: context.aggregateId,
      aggregateVersion: context.aggregateVersion,
      occurredAt: instant,
      recordedAt: instant,
      actorId: context.actorId,
      correlationId: context.correlationId,
      purpose: context.purpose,
      dataClassification: context.dataClassification ?? 'confidential',
      payload,
      ...(context.causationId === undefined ? {} : { causationId: context.causationId }),
      ...(context.policyDecisionRef === undefined ? {} : { policyDecisionRef: context.policyDecisionRef }),
    };
  }
}
