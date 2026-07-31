import type { AggregateRoot } from './aggregate-root.js';
import type { Result } from './result.js';

export interface AggregateRepository<T extends AggregateRoot> {
  get(tenantId: string, id: string): Promise<Result<T>>;
  save(aggregate: T, expectedVersion: number): Promise<Result<T>>;
}

export class InMemoryAggregateRepository<T extends AggregateRoot> implements AggregateRepository<T> {
  private readonly values = new Map<string, T>();

  async get(tenantId: string, id: string): Promise<Result<T>> {
    const aggregate = this.values.get(`${tenantId}:${id}`);
    return aggregate === undefined
      ? { ok: false, error: { code: 'NOT_FOUND', message: 'Resource not found' } }
      : { ok: true, value: aggregate };
  }

  async save(aggregate: T, expectedVersion: number): Promise<Result<T>> {
    const key = `${aggregate.tenantId}:${aggregate.id}`;
    const existing = this.values.get(key);
    const actual = existing?.version ?? 0;
    if (actual !== expectedVersion) {
      return {
        ok: false,
        error: {
          code: 'VERSION_CONFLICT',
          message: 'Aggregate version conflict',
          details: { expectedVersion, actualVersion: actual },
        },
      };
    }
    aggregate.version = expectedVersion + 1;
    this.values.set(key, aggregate);
    return { ok: true, value: aggregate };
  }
}
