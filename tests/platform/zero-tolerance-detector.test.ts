import { metrics } from '@opentelemetry/api';
import { InMemoryMetricExporter, MeterProvider, PeriodicExportingMetricReader, AggregationTemporality } from '@opentelemetry/sdk-metrics';
import { afterEach, describe, expect, it } from 'vitest';
import { numericPoints } from './metric-points.js';
import { Entitlement, type UsageReceipt } from '../../src/commercial-operations/domain/entities/entitlement.js';
import { InMemoryOutbox } from '../../src/platform/messaging/outbox.js';
import {
  UnmeteredPaidEffectDetector,
  type MeteredUsage,
  type PaidEffect,
  type UnmeteredPaidEffectSources,
} from '../../src/platform/observability/zero-tolerance-detector.js';
import type { DomainEventEnvelope } from '../../src/shared/contracts/envelopes.js';
import { EventFactory } from '../../src/shared/domain/event-factory.js';

const HOUR = 3_600_000;
const now = new Date('2026-08-09T12:00:00.000Z');
const settled = new Date(now.getTime() - 48 * HOUR);
const recent = new Date(now.getTime() - HOUR);

function sources(effects: readonly PaidEffect[], metered: readonly MeteredUsage[]): UnmeteredPaidEffectSources {
  return {
    paidEffects: async (since, until) =>
      effects.filter((effect) => effect.occurredAt >= since && effect.occurredAt <= until),
    meteredUsage: async () => metered,
  };
}

function paidEffectEvent(reference: string, tokens: number, occurredAt: Date): DomainEventEnvelope<{ tokens: number }> {
  const factory = new EventFactory({ now: () => occurredAt }, { next: () => reference });
  return factory.create('scenario-planning.run.tokens-consumed', {
    tenantId: 'tenant-a',
    aggregateType: 'ScenarioRun',
    aggregateId: reference,
    aggregateVersion: 1,
    actorId: 'actor-1',
    correlationId: 'correlation-1',
    purpose: 'scenario-planning',
  }, { tokens });
}

describe('UnmeteredPaidEffectDetector', () => {
  afterEach(() => {
    metrics.disable();
  });

  it('finds no violation when every paid effect is fully metered', async () => {
    const detector = new UnmeteredPaidEffectDetector(
      sources(
        [{ reference: 'run-1', tenantId: 'tenant-a', dimension: 'tokens', quantity: 500, occurredAt: settled }],
        [{ sourceReference: 'run-1', tenantId: 'tenant-a', dimension: 'tokens', quantity: 500 }],
      ),
      { now: () => now },
    );
    await expect(detector.detect()).resolves.toEqual([]);
  });

  it('reports a shortfall against usage receipts consumed on a real Entitlement', async () => {
    // Build the receipts the way commercial-operations actually produces them, through the
    // aggregate's own consume() path, so the detector is compared against real records.
    const entitlement = Entitlement.create('ent-1', 'tenant-a', ['scenario-planning'], { now: () => settled });
    // Entitlement.reserve() requires a quota for every dimension the request names.
    for (const dimension of ['tokens', 'moneyMinorUnits', 'toolCalls', 'branches', 'wallTimeMs', 'concurrency'] as const) {
      expect(entitlement.setQuota(dimension, { hardLimit: 10_000, allowOverage: false }).ok).toBe(true);
    }
    const reservation = entitlement.reserve(
      'res-1',
      { tokens: 1_000, moneyMinorUnits: 0, toolCalls: 0, branches: 0, wallTimeMs: 0, concurrency: 0 },
      new Date(settled.getTime() + HOUR),
      settled,
    );
    expect(reservation.ok).toBe(true);

    const receipts: UsageReceipt[] = [
      { id: 'receipt-1', reservationId: 'res-1', dimension: 'tokens', quantity: 300, sourceReference: 'run-1', occurredAt: settled },
      { id: 'receipt-2', reservationId: 'res-1', dimension: 'tokens', quantity: 200, sourceReference: 'run-2', occurredAt: settled },
    ];
    for (const receipt of receipts) expect(entitlement.consume(receipt).ok).toBe(true);

    // run-1 was billed 300 of the 800 tokens it actually consumed; run-3 was never billed at all.
    const effects: PaidEffect[] = [
      { reference: 'run-1', tenantId: 'tenant-a', dimension: 'tokens', quantity: 800, occurredAt: settled },
      { reference: 'run-2', tenantId: 'tenant-a', dimension: 'tokens', quantity: 200, occurredAt: settled },
      { reference: 'run-3', tenantId: 'tenant-a', dimension: 'tokens', quantity: 150, occurredAt: settled },
    ];
    const metered: MeteredUsage[] = receipts.map((receipt) => ({
      sourceReference: receipt.sourceReference,
      tenantId: 'tenant-a',
      dimension: receipt.dimension,
      quantity: receipt.quantity,
    }));

    const detector = new UnmeteredPaidEffectDetector(sources(effects, metered), { now: () => now });
    const violations = await detector.detect();
    expect(violations.map(({ reference, expectedQuantity, meteredQuantity }) =>
      ({ reference, expectedQuantity, meteredQuantity }))).toEqual([
      { reference: 'run-1', expectedQuantity: 800, meteredQuantity: 300 },
      { reference: 'run-3', expectedQuantity: 150, meteredQuantity: 0 },
    ]);
    for (const violation of violations) {
      expect(violation.invariant).toBe('unmetered-paid-effect');
      expect(violation.tenantId).toBe('tenant-a');
      expect(violation.detectedAt).toEqual(now);
    }
  });

  it('never attributes one tenant\'s metering to another tenant\'s effect', async () => {
    const detector = new UnmeteredPaidEffectDetector(
      sources(
        [{ reference: 'run-1', tenantId: 'tenant-a', dimension: 'tokens', quantity: 100, occurredAt: settled }],
        [{ sourceReference: 'run-1', tenantId: 'tenant-b', dimension: 'tokens', quantity: 100 }],
      ),
      { now: () => now },
    );
    await expect(detector.detect()).resolves.toMatchObject([{ tenantId: 'tenant-a', meteredQuantity: 0 }]);
  });

  it('does not accuse effects still inside the reconciliation grace period', async () => {
    const detector = new UnmeteredPaidEffectDetector(
      sources([{ reference: 'run-1', tenantId: 'tenant-a', dimension: 'tokens', quantity: 100, occurredAt: recent }], []),
      { now: () => now },
    );
    await expect(detector.detect()).resolves.toEqual([]);

    const strict = new UnmeteredPaidEffectDetector(
      sources([{ reference: 'run-1', tenantId: 'tenant-a', dimension: 'tokens', quantity: 100, occurredAt: recent }], []),
      { now: () => now, reconciliationGraceMs: 60_000, lookbackMs: 7 * 24 * HOUR },
    );
    await expect(strict.detect()).resolves.toHaveLength(1);
  });

  it('aggregates repeated effects on one reference and ignores non-positive quantities', async () => {
    const detector = new UnmeteredPaidEffectDetector(
      sources(
        [
          { reference: 'run-1', tenantId: 'tenant-a', dimension: 'tokens', quantity: 100, occurredAt: settled },
          { reference: 'run-1', tenantId: 'tenant-a', dimension: 'tokens', quantity: 100, occurredAt: settled },
          { reference: 'run-2', tenantId: 'tenant-a', dimension: 'tokens', quantity: 0, occurredAt: settled },
        ],
        [{ sourceReference: 'run-1', tenantId: 'tenant-a', dimension: 'tokens', quantity: 150 }],
      ),
      { now: () => now },
    );
    await expect(detector.detect()).resolves.toMatchObject([
      { reference: 'run-1', expectedQuantity: 200, meteredQuantity: 150 },
    ]);
  });

  it('separates dimensions so token metering cannot cover a tool-call effect', async () => {
    const detector = new UnmeteredPaidEffectDetector(
      sources(
        [{ reference: 'run-1', tenantId: 'tenant-a', dimension: 'toolCalls', quantity: 5, occurredAt: settled }],
        [{ sourceReference: 'run-1', tenantId: 'tenant-a', dimension: 'tokens', quantity: 5_000 }],
      ),
      { now: () => now },
    );
    await expect(detector.detect()).resolves.toMatchObject([{ dimension: 'toolCalls', meteredQuantity: 0 }]);
  });

  it('rejects a lookback that cannot cover its own grace period', () => {
    expect(() => new UnmeteredPaidEffectDetector(sources([], []), {
      reconciliationGraceMs: 86_400_000,
      lookbackMs: 3_600_000,
    })).toThrow(/Lookback must exceed/);
  });

  it('projects paid effects out of real outbox records and counts detected violations', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 600_000 });
    const provider = new MeterProvider({ readers: [reader] });
    metrics.setGlobalMeterProvider(provider);

    const outbox = new InMemoryOutbox();
    await outbox.append([paidEffectEvent('run-1', 400, settled), paidEffectEvent('run-2', 250, settled)]);
    const pending = await outbox.pending(100);
    expect(pending).toHaveLength(2);

    const detector = new UnmeteredPaidEffectDetector(
      {
        paidEffects: async () => pending.map((record) => ({
          reference: record.event.eventId,
          tenantId: record.event.tenantId,
          dimension: 'tokens',
          quantity: (record.event.payload as { tokens: number }).tokens,
          occurredAt: record.recordedAt,
        })),
        meteredUsage: async () => [{ sourceReference: 'run-1', tenantId: 'tenant-a', dimension: 'tokens', quantity: 400 }],
      },
      { now: () => now },
    );
    await expect(detector.detect()).resolves.toMatchObject([{ reference: 'run-2', meteredQuantity: 0 }]);

    await reader.forceFlush();
    const point = numericPoints(exporter, 'deliberation.zero_tolerance.violations')[0];
    expect(point?.value).toBe(1);
    expect(point?.attributes).toMatchObject({
      operation: 'usage-reconciliation',
      reason_code: 'unmetered-paid-effect',
      risk_tier: 'zero-tolerance',
    });
    await provider.shutdown();
  });
});
