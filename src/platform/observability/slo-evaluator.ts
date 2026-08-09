import { metrics } from '@opentelemetry/api';
import { Telemetry, evaluateSli, safeAttributes, type SliWindow } from './telemetry.js';

export interface SloObjective {
  /** Operation name, matching both slos.json's objective key and Telemetry.operation()'s name. */
  readonly name: string;
  readonly availability: number;
  readonly latencyThresholdMs?: number;
}

export interface SloEvaluation {
  readonly objective: string;
  readonly met: boolean;
  readonly availability: number;
  readonly sampleCount: number;
  readonly p95?: number;
  readonly p99?: number;
}

export interface SloEvaluatorOptions {
  readonly objectives: readonly SloObjective[];
  /** Sliding window of recent outcomes considered by each evaluation. Default 5 minutes. */
  readonly windowMs?: number;
  /** Hard per-objective sample ceiling. Memory is this many samples regardless of traffic. */
  readonly capacity?: number;
  /** How often start() re-evaluates. Default 1 minute. */
  readonly intervalMs?: number;
  readonly now?: () => number;
}

/**
 * Fixed-capacity ring of recent outcomes for one objective (ADR-048 consequences: the
 * self-evaluation window must be bounded, not an unbounded log). Backing storage is allocated
 * once at construction; recording past capacity overwrites the oldest sample, and samples older
 * than the evaluation window are skipped on read rather than compacted — the same opportunistic
 * approach ADR-034 takes for the replay store.
 */
class OutcomeRing {
  private readonly success: Uint8Array;
  private readonly latencyMs: Float64Array;
  private readonly recordedAt: Float64Array;
  private size = 0;
  private next = 0;

  constructor(private readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) {
      throw new Error('SLO evaluator capacity must be a positive integer');
    }
    this.success = new Uint8Array(capacity);
    this.latencyMs = new Float64Array(capacity);
    this.recordedAt = new Float64Array(capacity);
  }

  record(success: boolean, latencyMs: number, atMs: number): void {
    this.success[this.next] = success ? 1 : 0;
    this.latencyMs[this.next] = latencyMs;
    this.recordedAt[this.next] = atMs;
    this.next = (this.next + 1) % this.capacity;
    if (this.size < this.capacity) this.size += 1;
  }

  window(sinceMs: number): SliWindow {
    let total = 0;
    let good = 0;
    const latenciesMs: number[] = [];
    for (let offset = 0; offset < this.size; offset += 1) {
      const index = (this.next - 1 - offset + this.capacity * 2) % this.capacity;
      if (this.recordedAt[index]! < sinceMs) continue;
      total += 1;
      if (this.success[index] === 1) good += 1;
      latenciesMs.push(this.latencyMs[index]!);
    }
    return { total, good, latenciesMs };
  }
}

/**
 * ADR-048 item 2: the real caller for evaluateSli(). Holds a bounded sliding window of recent
 * operation outcomes, periodically evaluates them against slos.json's objectives, and exports
 * the verdict as `deliberation.slo.met` (1 when met, 0 when not) keyed by operation. The boolean
 * is the gauge's value rather than an attribute, which keeps one series per objective and needs
 * no new approved telemetry attribute key.
 */
export class SloEvaluator {
  private readonly meter = metrics.getMeter('@deliberation/platform');
  private readonly gauge = this.meter.createGauge('deliberation.slo.met');
  private readonly rings = new Map<string, OutcomeRing>();
  private readonly objectives: readonly SloObjective[];
  private readonly windowMs: number;
  private readonly capacity: number;
  private readonly intervalMs: number;
  private readonly now: () => number;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(options: SloEvaluatorOptions) {
    this.objectives = options.objectives;
    this.windowMs = options.windowMs ?? 300_000;
    this.capacity = options.capacity ?? 4_096;
    this.intervalMs = options.intervalMs ?? 60_000;
    this.now = options.now ?? (() => Date.now());
    for (const objective of this.objectives) this.rings.set(objective.name, new OutcomeRing(this.capacity));
  }

  /** Outcomes for operations with no declared objective are dropped, keeping memory bounded. */
  record(operation: string, outcome: 'success' | 'failure', latencyMs: number, atMs = this.now()): void {
    this.rings.get(operation)?.record(outcome === 'success', latencyMs, atMs);
  }

  evaluate(atMs = this.now()): readonly SloEvaluation[] {
    const since = atMs - this.windowMs;
    return this.objectives.map((objective) => {
      const window = this.rings.get(objective.name)!.window(since);
      const result = evaluateSli(window, objective.availability, objective.latencyThresholdMs);
      this.gauge.record(result.meetsObjective ? 1 : 0, safeAttributes({ operation: objective.name }));
      return {
        objective: objective.name,
        met: result.meetsObjective,
        availability: result.availability,
        sampleCount: window.total,
        ...(result.p95 === undefined ? {} : { p95: result.p95 }),
        ...(result.p99 === undefined ? {} : { p99: result.p99 }),
      };
    });
  }

  start(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => this.evaluate(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }
}

/**
 * Feeds an SloEvaluator from the same call sites that already emit spans and counters, without
 * modifying Telemetry itself: every operation() outcome is mirrored into the evaluator's window.
 */
export class SloAwareTelemetry extends Telemetry {
  constructor(private readonly evaluator: SloEvaluator) {
    super();
  }

  override async operation<T>(
    name: string,
    attributes: Readonly<Record<string, unknown>>,
    work: () => Promise<T>,
  ): Promise<T> {
    const started = performance.now();
    try {
      const result = await super.operation(name, attributes, work);
      this.evaluator.record(name, 'success', performance.now() - started);
      return result;
    } catch (cause) {
      this.evaluator.record(name, 'failure', performance.now() - started);
      throw cause;
    }
  }
}

export interface SloDeclaration {
  readonly version: number;
  readonly objectives: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

/**
 * Projects slos.json's objective fields onto what evaluateSli() can actually check: an
 * availability floor and a p99 latency ceiling. Objectives stating only a latency bound get an
 * availability floor of 0 so the latency bound alone decides the verdict.
 */
export function sloObjectivesFrom(declaration: SloDeclaration): readonly SloObjective[] {
  if (declaration.version !== 1) throw new Error(`Unsupported SLO declaration version ${declaration.version}`);
  return Object.entries(declaration.objectives).map(([name, fields]) => {
    const availability = fields['availability'] ?? fields['availabilityWithin24Hours'] ?? 0;
    const latencyThresholdMs = fields['p99Ms'] ?? fields['maximumMs'];
    return {
      name,
      availability,
      ...(latencyThresholdMs === undefined ? {} : { latencyThresholdMs }),
    };
  });
}

export interface SloEvaluationHandle {
  readonly evaluator: SloEvaluator | undefined;
  stop(): void;
}

const noopHandle: SloEvaluationHandle = { evaluator: undefined, stop: () => undefined };

/**
 * Mirrors bootstrapTelemetry (ADR-033): starts a real periodic evaluation loop only when an
 * adopter opts in with DELIBERATION_SLO_SELF_EVALUATION=true, and is a safe no-op otherwise.
 */
export function bootstrapSloEvaluation(
  declaration: SloDeclaration,
  options: { readonly env?: NodeJS.ProcessEnv; readonly intervalMs?: number; readonly windowMs?: number } = {},
): SloEvaluationHandle {
  const env = options.env ?? process.env;
  if (env['DELIBERATION_SLO_SELF_EVALUATION'] !== 'true') return noopHandle;
  const evaluator = new SloEvaluator({
    objectives: sloObjectivesFrom(declaration),
    ...(options.intervalMs === undefined ? {} : { intervalMs: options.intervalMs }),
    ...(options.windowMs === undefined ? {} : { windowMs: options.windowMs }),
  });
  evaluator.start();
  return { evaluator, stop: () => evaluator.stop() };
}
