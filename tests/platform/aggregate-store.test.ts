import { describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { EventFactory, FixedClock, UuidGenerator } from '../../src/shared/domain/index.js';
import { PostgresAggregateStore, PostgresUnitOfWork } from '../../src/platform/persistence/index.js';

describe('transactional aggregate/outbox store', () => {
  it('writes CAS aggregate and matching outbox in one tenant transaction', async () => {
    const query = vi.fn(async (sql: string) => ({
      rows: /RETURNING (?:version|event_id)/.test(sql) ? [{ version: 1, event_id: 'event' }] : [],
    }));
    const client = { query, release: vi.fn() } as unknown as PoolClient;
    const uow = new PostgresUnitOfWork({ connect: async () => client } as unknown as Pool);
    const tenantId = randomUUID();
    const aggregateId = randomUUID();
    const event = new EventFactory(new FixedClock(new Date('2026-01-01')), new UuidGenerator()).create('Created', {
      tenantId, aggregateType: 'Case', aggregateId, aggregateVersion: 1,
      actorId: randomUUID(), correlationId: randomUUID(), purpose: 'test',
    }, {});
    const result = await uow.inTenantTransaction(tenantId, () =>
      new PostgresAggregateStore('deliberation', uow).save({
        tenantId, aggregateType: 'Case', aggregateId, version: 1, state: {},
        classification: 'confidential', retentionPolicyId: 'r',
        createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
      }, 0, [event]));
    expect(result.ok).toBe(true);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('deliberation.outbox'))).toBe(true);
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });

  it('rejects invalid schemas, mismatched versions and duplicate inbox claims', async () => {
    const client = {
      query: vi.fn(async (sql: string) => ({ rows: String(sql).includes('inbox') ? [] : [] })),
      release: vi.fn(),
    } as unknown as PoolClient;
    const uow = new PostgresUnitOfWork({ connect: async () => client } as unknown as Pool);
    expect(() => new PostgresAggregateStore('../unsafe', uow)).toThrow();
    const tenantId = randomUUID();
    const event = new EventFactory(new FixedClock(new Date('2026-01-01')), new UuidGenerator()).create('Created', {
      tenantId, aggregateType: 'Case', aggregateId: randomUUID(), aggregateVersion: 1,
      actorId: randomUUID(), correlationId: randomUUID(), purpose: 'test',
    }, {});
    await uow.inTenantTransaction(tenantId, async () => {
      const store = new PostgresAggregateStore('deliberation', uow);
      expect((await store.save({
        tenantId, aggregateType: 'Case', aggregateId: event.aggregateId, version: 2,
        state: {}, classification: 'confidential', retentionPolicyId: 'r',
        createdAt: new Date(), updatedAt: new Date(),
      }, 0, [])).ok).toBe(false);
      expect(await store.claimInbox('consumer', event, new Date())).toBe(false);
    });
  });
});
