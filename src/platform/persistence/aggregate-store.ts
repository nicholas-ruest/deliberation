import type { DomainEventEnvelope } from '../../shared/contracts/index.js';
import type { Result } from '../../shared/domain/result.js';
import type { PostgresUnitOfWork } from './postgres.js';

export interface PersistedAggregate {
  readonly tenantId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly version: number;
  readonly state: Readonly<Record<string, unknown>>;
  readonly classification: 'public' | 'internal' | 'confidential' | 'restricted';
  readonly retentionPolicyId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class PostgresAggregateStore {
  constructor(
    private readonly contextSchema: string,
    private readonly unitOfWork: PostgresUnitOfWork,
  ) {
    if (!/^[a-z][a-z0-9_]+$/.test(contextSchema)) throw new Error('Invalid context schema');
  }

  async save(
    aggregate: PersistedAggregate,
    expectedVersion: number,
    events: readonly DomainEventEnvelope[],
  ): Promise<Result<PersistedAggregate>> {
    if (aggregate.tenantId !== this.unitOfWork.current().tenantId || aggregate.version !== expectedVersion + 1) {
      return { ok: false, error: { code: 'VERSION_CONFLICT', message: 'Tenant/version boundary mismatch' } };
    }
    const table = `${this.contextSchema}.aggregates`;
    const rows = expectedVersion === 0
      ? await this.unitOfWork.query<{ version: number }>(`
          INSERT INTO __TABLE__
            (tenant_id, aggregate_type, aggregate_id, version, state, classification,
             retention_policy_id, created_at, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          ON CONFLICT DO NOTHING
          RETURNING version
        `.replace('__TABLE__', table), [
          aggregate.tenantId, aggregate.aggregateType, aggregate.aggregateId, aggregate.version,
          aggregate.state, aggregate.classification, aggregate.retentionPolicyId,
          aggregate.createdAt, aggregate.updatedAt,
        ])
      : await this.unitOfWork.query<{ version: number }>(`
          UPDATE __TABLE__
             SET version = $4, state = $5, classification = $6,
                 retention_policy_id = $7, updated_at = $9
           WHERE tenant_id = $1 AND aggregate_type = $2 AND aggregate_id = $3 AND version = $10
          RETURNING version
        `.replace('__TABLE__', table), [
          aggregate.tenantId, aggregate.aggregateType, aggregate.aggregateId, aggregate.version,
          aggregate.state, aggregate.classification, aggregate.retentionPolicyId,
          aggregate.createdAt, aggregate.updatedAt, expectedVersion,
        ]);
    if (rows.length !== 1) {
      return { ok: false, error: { code: 'VERSION_CONFLICT', message: 'Concurrent aggregate update detected' } };
    }
    for (const event of events) {
      if (event.tenantId !== aggregate.tenantId || event.aggregateId !== aggregate.aggregateId
        || event.aggregateVersion !== aggregate.version) {
        return { ok: false, error: { code: 'INVARIANT_VIOLATION', message: 'Event does not match saved aggregate version' } };
      }
      await this.unitOfWork.query(`
        INSERT INTO __SCHEMA__.outbox
          (event_id, tenant_id, aggregate_id, aggregate_version, event_type,
           schema_version, envelope, recorded_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (event_id) DO NOTHING
        RETURNING event_id
      `.replace('__SCHEMA__', this.contextSchema), [
        event.eventId, event.tenantId, event.aggregateId, event.aggregateVersion,
        event.eventType, event.schemaVersion, event, event.recordedAt,
      ]);
    }
    return { ok: true, value: aggregate };
  }

  async claimInbox(consumerName: string, event: DomainEventEnvelope, processedAt: Date): Promise<boolean> {
    const rows = await this.unitOfWork.query<{ event_id: string }>(`
      INSERT INTO __SCHEMA__.inbox (consumer_name, event_id, tenant_id, processed_at)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (consumer_name, event_id) DO NOTHING
      RETURNING event_id
    `.replace('__SCHEMA__', this.contextSchema), [consumerName, event.eventId, event.tenantId, processedAt]);
    return rows.length === 1;
  }
}
