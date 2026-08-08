import { metrics, trace } from '@opentelemetry/api';
import { afterEach, describe, expect, it } from 'vitest';
import { bootstrapTelemetry } from '../../src/platform/observability/otel-bootstrap.js';

describe('bootstrapTelemetry', () => {
  afterEach(() => {
    trace.disable();
    metrics.disable();
  });

  it('registers nothing when no export target is configured, leaving the API no-op default in place', async () => {
    const handle = bootstrapTelemetry({ serviceName: 'test', serviceVersion: '0.0.0', env: {} });
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it('registers real console-exporting providers when OTEL_CONSOLE_EXPORTER=true', async () => {
    const handle = bootstrapTelemetry({
      serviceName: 'test',
      serviceVersion: '0.0.0',
      env: { OTEL_CONSOLE_EXPORTER: 'true' },
    });
    expect(trace.getTracerProvider()).toBeDefined();
    expect(metrics.getMeterProvider()).toBeDefined();
    await handle.shutdown();
  });

  it('registers OTLP-exporting providers when an endpoint is configured', async () => {
    const handle = bootstrapTelemetry({
      serviceName: 'test',
      serviceVersion: '0.0.0',
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318' },
    });
    expect(trace.getTracerProvider()).toBeDefined();
    await handle.shutdown();
  });
});
