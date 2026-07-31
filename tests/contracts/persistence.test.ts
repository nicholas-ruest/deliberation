import { describe, expect, it } from 'vitest';
import { AggregateRoot, InMemoryAggregateRepository } from '../../src/shared/domain/index.js';
import { EncryptedInMemoryObjectStore } from '../../src/platform/persistence/index.js';

class ExampleAggregate extends AggregateRoot {
  static create(id: string, tenantId: string): ExampleAggregate {
    const now = new Date('2026-01-01T00:00:00Z');
    return new ExampleAggregate(id, tenantId, 0, now, now);
  }
}

describe('persistence contracts', () => {
  it('enforces optimistic concurrency and tenant identity', async () => {
    const repository = new InMemoryAggregateRepository<ExampleAggregate>();
    const aggregate = ExampleAggregate.create('a', 'tenant-a');
    expect((await repository.save(aggregate, 0)).ok).toBe(true);
    expect((await repository.save(aggregate, 0)).ok).toBe(false);
    expect((await repository.get('tenant-b', 'a')).ok).toBe(false);
  });

  it('stores immutable payloads with opaque tenant/purpose-bound references', async () => {
    const store = EncryptedInMemoryObjectStore.forTests();
    const stored = await store.put(Buffer.from('private evidence'), {
      tenantId: 'tenant-a',
      purpose: 'case-evidence',
      sensitivity: 'restricted',
      retentionPolicyId: 'r1',
    });
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    expect(stored.value.objectId).not.toContain('tenant-a');
    expect((await store.get(stored.value, 'tenant-b', 'case-evidence')).ok).toBe(false);
    const loaded = await store.get(stored.value, 'tenant-a', 'case-evidence');
    expect(loaded.ok && Buffer.from(loaded.value).toString()).toBe('private evidence');
  });
});
