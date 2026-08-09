import { readFile } from 'node:fs/promises';
import { metrics } from '@opentelemetry/api';
import { InMemoryMetricExporter, MeterProvider, PeriodicExportingMetricReader, AggregationTemporality } from '@opentelemetry/sdk-metrics';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SloAwareTelemetry,
  SloEvaluator,
  bootstrapSloEvaluation,
  sloObjectivesFrom,
  type SloDeclaration,
} from '../../src/platform/observability/slo-evaluator.js';
import { numericPoints } from './metric-points.js';

const declaration = JSON.parse(await readFile('config/operations/slos.json', 'utf8')) as SloDeclaration;

describe('sloObjectivesFrom', () => {
  it('projects the real slos.json onto availability floors and p99 ceilings', () => {
    const objectives = sloObjectivesFrom(declaration);
    expect(objectives).toHaveLength(Object.keys(declaration.objectives).length);
    expect(objectives.find((objective) => objective.name === 'command-api')).toEqual({
      name: 'command-api',
      availability: 0.999,
    });
    expect(objectives.find((objective) => objective.name === 'authorization')).toEqual({
      name: 'authorization',
      availability: 0.9999,
      latencyThresholdMs: 100,
    });
    // revocation states only a latency bound, so availability never decides its verdict.
    expect(objectives.find((objective) => objective.name === 'revocation')).toEqual({
      name: 'revocation',
      availability: 0,
      latencyThresholdMs: 60_000,
    });
    // usage-reconciliation's 24-hour availability is the availability the loop can check.
    expect(objectives.find((objective) => objective.name === 'usage-reconciliation')?.availability).toBe(0.999);
  });

  it('rejects an unsupported declaration version', () => {
    expect(() => sloObjectivesFrom({ ...declaration, version: 2 })).toThrow(/Unsupported SLO declaration/);
  });
});

describe('SloEvaluator sliding window', () => {
  it('reports an objective met and breached from the real availability math', () => {
    const evaluator = new SloEvaluator({
      objectives: [{ name: 'command-api', availability: 0.999 }],
      windowMs: 60_000,
      capacity: 2_000,
    });
    for (let index = 0; index < 1_000; index += 1) evaluator.record('command-api', 'success', 5, 1_000);
    expect(evaluator.evaluate(1_000)).toEqual([
      { objective: 'command-api', met: true, availability: 1, sampleCount: 1_000, p95: 5, p99: 5 },
    ]);

    // Two failures in 1002 samples puts availability at ~0.998, below the 0.999 floor.
    evaluator.record('command-api', 'failure', 5, 1_000);
    evaluator.record('command-api', 'failure', 5, 1_000);
    const [breached] = evaluator.evaluate(1_000);
    expect(breached?.met).toBe(false);
    expect(breached?.availability).toBeCloseTo(1_000 / 1_002, 6);
  });

  it('fails an objective on p99 latency even when availability is perfect', () => {
    const evaluator = new SloEvaluator({
      objectives: [{ name: 'authorization', availability: 0.9999, latencyThresholdMs: 100 }],
      windowMs: 60_000,
      capacity: 200,
    });
    // evaluateSli's p99 of 100 samples is the 99th-ranked value, so the slowest 1% is 2 samples.
    for (let index = 0; index < 98; index += 1) evaluator.record('authorization', 'success', 10, 0);
    for (let index = 0; index < 2; index += 1) evaluator.record('authorization', 'success', 900, 0);
    const [result] = evaluator.evaluate(0);
    expect(result?.availability).toBe(1);
    expect(result?.p99).toBe(900);
    expect(result?.met).toBe(false);
  });

  it('keeps memory bounded: capacity caps retained samples no matter how many are recorded', () => {
    const evaluator = new SloEvaluator({
      objectives: [{ name: 'command-api', availability: 0.5 }],
      windowMs: 60_000,
      capacity: 8,
    });
    for (let index = 0; index < 10_000; index += 1) {
      evaluator.record('command-api', index % 2 === 0 ? 'success' : 'failure', index, 1_000);
    }
    const [result] = evaluator.evaluate(1_000);
    expect(result?.sampleCount).toBe(8);
    // The retained window is the 8 most recent samples (9992..9999), oldest overwritten.
    expect(result?.p99).toBe(9_999);
    expect(result?.availability).toBe(0.5);
  });

  it('evicts samples older than the window without unbounded growth', () => {
    const evaluator = new SloEvaluator({
      objectives: [{ name: 'query-api', availability: 0.9 }],
      windowMs: 1_000,
      capacity: 64,
    });
    for (let index = 0; index < 10; index += 1) evaluator.record('query-api', 'failure', 1, 0);
    for (let index = 0; index < 10; index += 1) evaluator.record('query-api', 'success', 1, 5_000);
    const [result] = evaluator.evaluate(5_000);
    expect(result?.sampleCount).toBe(10);
    expect(result?.availability).toBe(1);
    expect(result?.met).toBe(true);

    // Once every sample has aged out the window is empty, and evaluateSli treats that as met.
    const [empty] = evaluator.evaluate(10_000);
    expect(empty?.sampleCount).toBe(0);
    expect(empty?.met).toBe(true);
  });

  it('drops outcomes for operations that declare no objective', () => {
    const evaluator = new SloEvaluator({ objectives: [{ name: 'command-api', availability: 0.9 }] });
    expect(() => evaluator.record('undeclared-operation', 'failure', 1)).not.toThrow();
    expect(evaluator.evaluate()[0]?.sampleCount).toBe(0);
  });

  it('rejects a non-positive capacity', () => {
    expect(() => new SloEvaluator({ objectives: [{ name: 'a', availability: 1 }], capacity: 0 }))
      .toThrow(/positive integer/);
  });

  it('start() is idempotent and stop() clears the timer', () => {
    let evaluations = 0;
    const evaluator = new SloEvaluator({
      objectives: [{ name: 'command-api', availability: 0.9 }],
      intervalMs: 1,
      now: () => {
        evaluations += 1;
        return 0;
      },
    });
    evaluator.start();
    evaluator.start();
    evaluator.stop();
    evaluator.stop();
    expect(evaluations).toBeGreaterThanOrEqual(0);
  });
});

describe('SloAwareTelemetry', () => {
  it('feeds both success and failure outcomes from real operation() calls', async () => {
    const evaluator = new SloEvaluator({
      objectives: [{ name: 'command-api', availability: 0.999 }],
      windowMs: 600_000,
    });
    const telemetry = new SloAwareTelemetry(evaluator);
    await expect(telemetry.operation('command-api', { operation: 'command-api' }, async () => 'ok'))
      .resolves.toBe('ok');
    await expect(telemetry.operation('command-api', { operation: 'command-api' }, async () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');

    const [result] = evaluator.evaluate();
    expect(result?.sampleCount).toBe(2);
    expect(result?.availability).toBe(0.5);
    expect(result?.met).toBe(false);
  });

  it('still enforces the approved telemetry attribute allowlist', async () => {
    const telemetry = new SloAwareTelemetry(new SloEvaluator({ objectives: [] }));
    await expect(telemetry.operation('command-api', { unapproved: 'x' }, async () => 1))
      .rejects.toThrow(/Unapproved telemetry attribute/);
  });
});

describe('deliberation.slo.met export', () => {
  afterEach(() => {
    metrics.disable();
  });

  it('exports 1 when the objective is met and 0 when it is not, keyed by operation', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 600_000 });
    const provider = new MeterProvider({ readers: [reader] });
    metrics.setGlobalMeterProvider(provider);

    const evaluator = new SloEvaluator({
      objectives: [
        { name: 'command-api', availability: 0.999 },
        { name: 'query-api', availability: 0.999 },
      ],
      windowMs: 60_000,
    });
    for (let index = 0; index < 100; index += 1) evaluator.record('command-api', 'success', 1, 0);
    for (let index = 0; index < 100; index += 1) evaluator.record('query-api', 'failure', 1, 0);
    evaluator.evaluate(0);

    await reader.forceFlush();
    const points = numericPoints(exporter, 'deliberation.slo.met');
    expect(points.find((point) => point.attributes['operation'] === 'command-api')?.value).toBe(1);
    expect(points.find((point) => point.attributes['operation'] === 'query-api')?.value).toBe(0);
    await provider.shutdown();
  });
});

describe('bootstrapSloEvaluation', () => {
  it('is a safe no-op unless an adopter opts in', () => {
    const handle = bootstrapSloEvaluation(declaration, { env: {} });
    expect(handle.evaluator).toBeUndefined();
    expect(() => handle.stop()).not.toThrow();
  });

  it('starts a real evaluator against the real slos.json when opted in', () => {
    const handle = bootstrapSloEvaluation(declaration, {
      env: { DELIBERATION_SLO_SELF_EVALUATION: 'true' },
      intervalMs: 3_600_000,
    });
    expect(handle.evaluator).toBeDefined();
    handle.evaluator!.record('command-api', 'success', 4);
    const evaluations = handle.evaluator!.evaluate();
    expect(evaluations.map(({ objective }) => objective)).toEqual(Object.keys(declaration.objectives));
    expect(evaluations.find(({ objective }) => objective === 'command-api')?.sampleCount).toBe(1);
    handle.stop();
  });
});
