import { context, metrics, trace, SpanStatusCode, type Attributes } from '@opentelemetry/api';

const allowedKeys = new Set([
  'service', 'version', 'environment', 'region', 'cell', 'operation', 'outcome',
  'reason_code', 'correlation_bucket', 'workflow_type', 'dependency', 'status',
  'tenant_bucket', 'model_id', 'connector_type', 'risk_tier',
]);

export function safeAttributes(candidate: Readonly<Record<string, unknown>>): Attributes {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (!allowedKeys.has(key)) throw new Error(`Unapproved telemetry attribute rejected: ${key}`);
    if (typeof value === 'string' && (value.length > 120 || /-----BEGIN|bearer\s+|api[_-]?key|password|secret/i.test(value))) {
      throw new Error(`Potential sensitive/high-cardinality telemetry value rejected: ${key}`);
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') result[key] = value;
  }
  return result;
}

export class Telemetry {
  private readonly tracer = trace.getTracer('@deliberation/platform');
  private readonly meter = metrics.getMeter('@deliberation/platform');
  private readonly operationCounter = this.meter.createCounter('deliberation.operations');
  private readonly latency = this.meter.createHistogram('deliberation.operation.duration_ms');

  async operation<T>(
    name: string,
    attributes: Readonly<Record<string, unknown>>,
    work: () => Promise<T>,
  ): Promise<T> {
    const safe = safeAttributes(attributes);
    const started = performance.now();
    return this.tracer.startActiveSpan(name, { attributes: safe }, context.active(), async (span) => {
      try {
        const result = await work();
        this.operationCounter.add(1, { ...safe, outcome: 'success' });
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (cause) {
        this.operationCounter.add(1, { ...safe, outcome: 'failure' });
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw cause;
      } finally {
        this.latency.record(performance.now() - started, safe);
        span.end();
      }
    });
  }
}

export interface SliWindow {
  readonly total: number;
  readonly good: number;
  readonly latenciesMs: readonly number[];
}

export function evaluateSli(window: SliWindow, objective: number, latencyThresholdMs?: number): {
  readonly availability: number;
  readonly meetsObjective: boolean;
  readonly p95?: number;
  readonly p99?: number;
} {
  const availability = window.total === 0 ? 1 : window.good / window.total;
  const sorted = [...window.latenciesMs].sort((a, b) => a - b);
  const percentile = (p: number) => sorted.length === 0 ? undefined : sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
  const p95 = percentile(0.95);
  const p99 = percentile(0.99);
  return {
    availability,
    meetsObjective: availability >= objective && (latencyThresholdMs === undefined || (p99 ?? 0) <= latencyThresholdMs),
    ...(p95 === undefined ? {} : { p95 }),
    ...(p99 === undefined ? {} : { p99 }),
  };
}
