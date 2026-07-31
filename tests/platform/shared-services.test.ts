import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  EventFactory, FixedClock, IdempotencyStore, Money, UuidGenerator, canonicalHash,
} from '../../src/shared/index.js';
import { CommandEnvelopeSchema, DomainEventEnvelopeSchema } from '../../src/shared/contracts/index.js';
import { Inbox, InMemoryOutbox, relayOutbox } from '../../src/platform/messaging/index.js';
import { computeCalibration } from '../../src/learning/domain/services/index.js';
import { SubjectResolver } from '../../src/identity-access/application/index.js';
import { Principal, Tenant } from '../../src/identity-access/domain/index.js';

describe('shared application primitives', () => {
  it('canonicalizes idempotency payloads and rejects conflicting replay', () => {
    const store = new IdempotencyStore();
    const now = new Date('2026-01-01');
    let calls = 0;
    const execute = (request: unknown) => store.execute('tenant:command', 'key-12345', request, now, 1000, () => {
      calls += 1;
      return { ok: true, value: calls };
    });
    expect(execute({ b: 2, a: 1 })).toEqual({ ok: true, value: 1 });
    expect(execute({ a: 1, b: 2 })).toEqual({ ok: true, value: 1 });
    expect(execute({ a: 2 }).ok).toBe(false);
    expect(calls).toBe(1);
    expect(canonicalHash(['a', { b: true }])).toHaveLength(64);
  });

  it('supports currency-tagged minor-unit arithmetic', () => {
    expect(Money.of(10n, 'USD').add(Money.of(5n, 'USD')).minorUnits).toBe(15n);
    expect(Money.of(10n, 'USD').subtract(Money.of(3n, 'USD')).minorUnits).toBe(7n);
    expect(() => Money.of(1n, 'USD').add(Money.of(1n, 'EUR'))).toThrow();
    expect(() => Money.of(1n, 'usd')).toThrow();
  });

  it('creates and validates complete event and command envelopes', () => {
    const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
    const ids = new UuidGenerator();
    const event = new EventFactory(clock, ids).create('ExampleOccurred', {
      tenantId: randomUUID(), aggregateType: 'Example', aggregateId: randomUUID(), aggregateVersion: 1,
      actorId: randomUUID(), correlationId: randomUUID(), purpose: 'test',
    }, { value: 1 });
    expect(DomainEventEnvelopeSchema.parse(event).eventType).toBe('ExampleOccurred');
    expect(CommandEnvelopeSchema.safeParse({
      commandId: randomUUID(), commandType: 'Example', schemaVersion: 1,
      tenantId: randomUUID(), principalId: randomUUID(), subjectSessionEpoch: 0,
      idempotencyKey: 'key-12345', correlationId: randomUUID(), purpose: 'test', riskTier: 'low',
      requestedAt: clock.now().toISOString(), deadline: new Date('2026-01-02').toISOString(), payload: {},
    }).success).toBe(true);
  });
});

describe('outbox/inbox', () => {
  it('publishes committed records at least once and deduplicates consumer handling', async () => {
    const event = new EventFactory(new FixedClock(new Date('2026-01-01')), new UuidGenerator()).create('Occurred', {
      tenantId: randomUUID(), aggregateType: 'A', aggregateId: randomUUID(), aggregateVersion: 1,
      actorId: randomUUID(), correlationId: randomUUID(), purpose: 'test',
    }, {});
    const outbox = new InMemoryOutbox();
    await outbox.append([event, event]);
    const publish = vi.fn(async () => undefined);
    expect(await relayOutbox(outbox, { publish }, new Date('2026-01-01'))).toBe(1);
    expect(await relayOutbox(outbox, { publish }, new Date('2026-01-01'))).toBe(0);
    const inbox = new Inbox();
    const handler = vi.fn(async () => undefined);
    expect(await inbox.once('consumer', event.eventId, handler)).toBe(true);
    expect(await inbox.once('consumer', event.eventId, handler)).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('subject resolution and calibration', () => {
  it('fails closed for disabled/stale subjects and invalidates cache', async () => {
    const clock = new FixedClock(new Date('2026-01-01'));
    const tenant = Tenant.create('tenant', 'Legal', 'Display', clock);
    tenant.configure('eu', { provider: 'oidc', issuer: 'issuer', breakGlassAdministratorIds: ['owner'] }, 'key', clock);
    const events = new EventFactory(clock, new UuidGenerator());
    tenant.activate(events, randomUUID(), randomUUID());
    const principal = Principal.provision('principal', 'tenant', 'oidc', 'subject', clock);
    principal.grant('member', clock);
    const resolver = new SubjectResolver({
      tenant: async () => tenant,
      principal: async () => principal,
    }, 30_000);
    const resolved = await resolver.resolve('tenant', 'principal', principal.sessionEpoch, clock.now());
    expect(resolved.ok).toBe(true);
    resolver.revoke('tenant', 'principal');
    principal.disable(clock);
    expect((await resolver.resolve('tenant', 'principal', principal.sessionEpoch, clock.now())).ok).toBe(false);
  });

  it('computes calibration only for qualified minimum cohorts', () => {
    expect(computeCalibration([{ probability: 0.5, observed: 1 }], 2)).toBeUndefined();
    const result = computeCalibration([
      { probability: 0.8, observed: 1 }, { probability: 0.2, observed: 0 },
    ], 2);
    expect(result?.brierScore).toBeCloseTo(0.04);
    expect(() => computeCalibration([{ probability: 2, observed: 1 }], 1)).toThrow();
  });
});
