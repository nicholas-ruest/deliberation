import { diag, DiagConsoleLogger, DiagLogLevel, metrics, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ConsoleMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type PushMetricExporter,
} from '@opentelemetry/sdk-metrics';
import { BatchSpanProcessor, ConsoleSpanExporter, type SpanExporter } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ATTR_DEPLOYMENT_ENVIRONMENT_NAME, ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

export interface TelemetryBootstrapOptions {
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly env?: NodeJS.ProcessEnv;
}

export interface TelemetryHandle {
  shutdown(): Promise<void>;
}

const noopHandle: TelemetryHandle = { shutdown: async () => undefined };

/**
 * Registers real OTel trace/metric providers when an adopter configures an export target
 * (OTEL_EXPORTER_OTLP_ENDPOINT, or OTEL_CONSOLE_EXPORTER=true for local inspection). With
 * neither set, this deliberately registers nothing and leaves the OTel API's built-in no-op
 * providers in place — telemetry.ts call sites remain safe to invoke either way.
 */
export function bootstrapTelemetry(options: TelemetryBootstrapOptions): TelemetryHandle {
  const env = options.env ?? process.env;
  const otlpEndpoint = env['OTEL_EXPORTER_OTLP_ENDPOINT'];
  const consoleExporterEnabled = env['OTEL_CONSOLE_EXPORTER'] === 'true';
  if (otlpEndpoint === undefined && !consoleExporterEnabled) return noopHandle;

  if (env['OTEL_DIAG_LOG'] === 'true') diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: options.serviceName,
    [ATTR_SERVICE_VERSION]: options.serviceVersion,
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: env['NODE_ENV'] ?? 'development',
  });

  const traceExporter: SpanExporter = otlpEndpoint !== undefined
    ? new OTLPTraceExporter({ url: `${otlpEndpoint}/v1/traces` })
    : new ConsoleSpanExporter();
  const metricExporter: PushMetricExporter = otlpEndpoint !== undefined
    ? new OTLPMetricExporter({ url: `${otlpEndpoint}/v1/metrics` })
    : new ConsoleMetricExporter();

  const tracerProvider = new NodeTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(traceExporter)],
  });
  const contextManager = new AsyncLocalStorageContextManager();
  contextManager.enable();
  tracerProvider.register({ contextManager });

  const meterProvider = new MeterProvider({
    resource,
    readers: [new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 15_000 })],
  });
  metrics.setGlobalMeterProvider(meterProvider);

  return {
    shutdown: async () => {
      await Promise.allSettled([tracerProvider.shutdown(), meterProvider.shutdown()]);
      trace.disable();
      metrics.disable();
    },
  };
}
