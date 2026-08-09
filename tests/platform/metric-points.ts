import type { Attributes } from '@opentelemetry/api';
import { DataPointType, type InMemoryMetricExporter } from '@opentelemetry/sdk-metrics';

export interface NumericPoint {
  readonly attributes: Attributes;
  readonly value: number;
}

/** Flattens a real in-memory OTel export down to the numeric points for one metric name. */
export function numericPoints(exporter: InMemoryMetricExporter, name: string): readonly NumericPoint[] {
  const points: NumericPoint[] = [];
  for (const resourceMetric of exporter.getMetrics()) {
    for (const scope of resourceMetric.scopeMetrics) {
      for (const metric of scope.metrics) {
        if (metric.descriptor.name !== name) continue;
        if (metric.dataPointType !== DataPointType.SUM && metric.dataPointType !== DataPointType.GAUGE) continue;
        for (const point of metric.dataPoints) points.push({ attributes: point.attributes, value: point.value });
      }
    }
  }
  return points;
}
