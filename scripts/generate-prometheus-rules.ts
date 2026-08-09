import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * ADR-048 item 1: translate config/operations/slos.json and alerts.json into Prometheus
 * recording/alerting rules so the numbers that page an operator are the numbers checked into
 * this repository, not a hand-copied second set. This repository does not run Prometheus; it
 * only emits the rule file an adopter imports.
 *
 * Metric names below are the Prometheus renderings of what `Telemetry` actually emits
 * (OTel dots become underscores, counters gain `_total`, histograms gain `_bucket`).
 */
const OPERATIONS_TOTAL = 'deliberation_operations_total';
const DURATION_BUCKET = 'deliberation_operation_duration_ms_bucket';
const REJECTIONS_TOTAL = 'deliberation_security_rejections_total';
const SLO_MET = 'deliberation_slo_met';
const ZERO_TOLERANCE_TOTAL = 'deliberation_zero_tolerance_violations_total';

const SLO_SOURCE = 'config/operations/slos.json';
const ALERT_SOURCE = 'config/operations/alerts.json';

export interface PrometheusRule {
  readonly record?: string;
  readonly alert?: string;
  readonly expr: string;
  readonly for?: string;
  readonly labels?: Readonly<Record<string, string>>;
  readonly annotations?: Readonly<Record<string, string>>;
}

export interface PrometheusRuleGroup {
  readonly name: string;
  readonly rules: readonly PrometheusRule[];
}

export interface GeneratedRules {
  readonly groups: readonly PrometheusRuleGroup[];
  /** Declarations that could not be translated into real PromQL, with the reason why. */
  readonly warnings: readonly string[];
}

export interface SloDocument {
  readonly version: number;
  readonly objectives: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly zeroTolerance: readonly string[];
}

export interface AlertDeclaration {
  readonly name: string;
  readonly window?: string;
  readonly burnRate?: number;
  readonly metric?: string;
  readonly severity: string;
}

export interface AlertDocument {
  readonly version: number;
  readonly alerts: readonly AlertDeclaration[];
}

/**
 * Operational alerts whose metric is an age gauge carry no threshold of their own; where
 * slos.json already states the bound, the alert is generated from that bound rather than from
 * an invented one. Alerts with no entry here and no derivable bound are reported as warnings
 * instead of being emitted with a made-up number.
 */
const AGE_THRESHOLD_FROM_OBJECTIVE: Readonly<Record<string, { readonly objective: string; readonly field: string }>> = {
  'audit-sealing-lag': { objective: 'audit-sealing', field: 'maximumMs' },
};

const DURATION_PATTERN = /^\d+[smhdw]$/;
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const METRIC_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function requireDuration(value: string, source: string): string {
  if (!DURATION_PATTERN.test(value)) throw new Error(`${source}: invalid Prometheus duration "${value}"`);
  return value;
}

const DURATION_UNIT_MS: Readonly<Record<string, number>> = {
  s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000,
};

function durationMs(value: string): number {
  const unit = value.slice(-1);
  return Number.parseInt(value.slice(0, -1), 10) * (DURATION_UNIT_MS[unit] ?? 0);
}

function requireName(value: string, source: string): string {
  if (!NAME_PATTERN.test(value)) throw new Error(`${source}: invalid objective/alert name "${value}"`);
  return value;
}

function requireMetric(value: string, source: string): string {
  if (!METRIC_PATTERN.test(value)) throw new Error(`${source}: invalid metric name "${value}"`);
  return value;
}

function pascal(...parts: readonly string[]): string {
  return parts
    .flatMap((part) => part.split(/[-_.]/))
    .filter((word) => word.length > 0)
    .map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`)
    .join('');
}

function ratioRecordName(kind: 'availability' | 'error', window: string): string {
  return `deliberation:operation_${kind}:ratio_rate${window}`;
}

function latencyRecordName(quantile: 95 | 99, window: string): string {
  return `deliberation:operation_latency:p${quantile}_rate${window}`;
}

/** Latency objective fields understood as "the p99 of <phase> must stay under N ms". */
function latencyObjectives(fields: Readonly<Record<string, number>>): readonly {
  readonly quantile: 95 | 99;
  readonly thresholdMs: number;
  readonly phase?: string;
  readonly approximate: boolean;
  readonly field: string;
}[] {
  const result: { quantile: 95 | 99; thresholdMs: number; phase?: string; approximate: boolean; field: string }[] = [];
  for (const [field, value] of Object.entries(fields)) {
    if (field === 'p95Ms') result.push({ quantile: 95, thresholdMs: value, approximate: false, field });
    else if (field === 'p99Ms') result.push({ quantile: 99, thresholdMs: value, approximate: false, field });
    else if (field === 'maximumMs') result.push({ quantile: 99, thresholdMs: value, approximate: true, field });
    else {
      const phased = /^(.+)P99Ms$/.exec(field);
      if (phased?.[1] !== undefined) {
        result.push({ quantile: 99, thresholdMs: value, phase: phased[1], approximate: false, field });
      }
    }
  }
  return result;
}

export function buildRules(slos: SloDocument, alerts: AlertDocument): GeneratedRules {
  if (slos.version !== 1) throw new Error(`${SLO_SOURCE}: unsupported version ${slos.version}`);
  if (alerts.version !== 1) throw new Error(`${ALERT_SOURCE}: unsupported version ${alerts.version}`);

  const warnings: string[] = [];
  const burnAlerts = alerts.alerts.filter((alert) => alert.burnRate !== undefined && alert.window !== undefined);
  const burnWindows = [...new Set(burnAlerts.map((alert) => requireDuration(alert.window!, ALERT_SOURCE)))]
    .sort((a, b) => durationMs(a) - durationMs(b));
  if (burnWindows.length === 0) throw new Error(`${ALERT_SOURCE}: no burn-rate alert declares a window`);
  // Every window below is one an alert actually declares, so no evaluation range is invented.
  const shortestWindow = burnWindows[0]!;
  const longestWindow = burnWindows.at(-1)!;

  const objectiveEntries = Object.entries(slos.objectives).map(([name, fields]) => ({
    name: requireName(name, SLO_SOURCE),
    fields,
  }));

  const recording: PrometheusRule[] = [];
  for (const window of burnWindows) {
    recording.push({
      record: ratioRecordName('availability', window),
      expr: `sum by (operation) (rate(${OPERATIONS_TOTAL}{outcome="success"}[${window}]))`
        + ` / sum by (operation) (rate(${OPERATIONS_TOTAL}[${window}]))`,
    });
    recording.push({
      record: ratioRecordName('error', window),
      expr: `sum by (operation) (rate(${OPERATIONS_TOTAL}{outcome="failure"}[${window}]))`
        + ` / sum by (operation) (rate(${OPERATIONS_TOTAL}[${window}]))`,
    });
  }
  for (const quantile of [95, 99] as const) {
    recording.push({
      record: latencyRecordName(quantile, shortestWindow),
      expr: `histogram_quantile(0.${quantile}, sum by (operation, le) (rate(${DURATION_BUCKET}[${shortestWindow}])))`,
    });
  }
  recording.push({
    record: `deliberation:security_rejections:rate${shortestWindow}`,
    expr: `sum by (operation, reason_code) (rate(${REJECTIONS_TOTAL}[${shortestWindow}]))`,
  });

  const burnRules: PrometheusRule[] = [];
  for (const objective of objectiveEntries) {
    const availability = objective.fields['availability'] ?? objective.fields['availabilityWithin24Hours'];
    if (availability === undefined) continue;
    const budget = 1 - availability;
    for (const alert of burnAlerts) {
      const window = alert.window!;
      burnRules.push({
        alert: pascal(alert.name, objective.name),
        expr: `${ratioRecordName('error', window)}{operation="${objective.name}"} > ${formatNumber(alert.burnRate!)}`
          + ` * ${formatNumber(budget)}`,
        for: window,
        labels: { severity: alert.severity, objective: objective.name, alert_rule: alert.name },
        annotations: {
          summary: `${objective.name} is burning its error budget at over ${formatNumber(alert.burnRate!)}x`,
          description: `Objective ${objective.name} targets ${formatNumber(availability)} availability`
            + ` (error budget ${formatNumber(budget)}); observed error ratio over ${window} exceeds`
            + ` ${formatNumber(alert.burnRate!)}x that budget.`,
          source: `${SLO_SOURCE} objectives.${objective.name}, ${ALERT_SOURCE} alerts.${alert.name}`,
        },
      });
    }
  }

  const latencyRules: PrometheusRule[] = [];
  for (const objective of objectiveEntries) {
    for (const latency of latencyObjectives(objective.fields)) {
      latencyRules.push({
        alert: pascal('latency-objective-breach', objective.name, latency.field),
        expr: `${latencyRecordName(latency.quantile, shortestWindow)}{operation="${objective.name}"}`
          + ` > ${formatNumber(latency.thresholdMs)}`,
        for: shortestWindow,
        labels: {
          objective: objective.name,
          objective_field: latency.field,
          ...(latency.phase === undefined ? {} : { phase: latency.phase }),
        },
        annotations: {
          summary: `${objective.name} p${latency.quantile} exceeds ${formatNumber(latency.thresholdMs)}ms`,
          description: latency.approximate
            ? `${SLO_SOURCE} states ${objective.name}.${latency.field}=${formatNumber(latency.thresholdMs)};`
              + ' a true maximum is not recoverable from histogram buckets, so p99 is used as the closest'
              + ' available approximation.'
            : `${SLO_SOURCE} states ${objective.name}.${latency.field}=${formatNumber(latency.thresholdMs)}.`,
          note: `severity is not declared for latency objectives in ${ALERT_SOURCE}`,
          source: `${SLO_SOURCE} objectives.${objective.name}.${latency.field}`,
        },
      });
    }
  }

  const selfEvaluationRules: PrometheusRule[] = [{
    alert: 'SelfEvaluatedSloBreach',
    expr: `${SLO_MET} == 0`,
    for: shortestWindow,
    labels: { severity: 'ticket', source: 'in-process' },
    annotations: {
      summary: 'In-process SLO self-evaluation reports an objective as not met',
      description: `${SLO_MET} is emitted by SloEvaluator (ADR-048 item 2) as 1 when the objective`
        + ' named by the operation label is met and 0 when it is not.',
      source: 'src/platform/observability/slo-evaluator.ts',
    },
  }];

  const operationalRules: PrometheusRule[] = [];
  for (const alert of alerts.alerts) {
    if (alert.metric === undefined) continue;
    const metric = requireMetric(alert.metric, ALERT_SOURCE);
    if (metric.endsWith('_total')) {
      operationalRules.push({
        alert: pascal(alert.name),
        expr: `increase(${metric}[${longestWindow}]) > 0`,
        for: '0s',
        labels: { severity: alert.severity, alert_rule: alert.name },
        annotations: {
          summary: `${alert.name}: ${metric} increased`,
          description: `${ALERT_SOURCE} declares ${alert.name} against ${metric} with no threshold;`
            + ' any increase of this counter is itself the condition.',
          source: `${ALERT_SOURCE} alerts.${alert.name}`,
        },
      });
      continue;
    }
    const derived = AGE_THRESHOLD_FROM_OBJECTIVE[alert.name];
    const thresholdMs = derived === undefined ? undefined : slos.objectives[derived.objective]?.[derived.field];
    if (derived === undefined || thresholdMs === undefined) {
      warnings.push(
        `${alert.name}: no threshold is declared in ${ALERT_SOURCE} and none is derivable from`
        + ` ${SLO_SOURCE}, so only a recording rule for ${metric} is emitted, not an alert.`,
      );
      operationalRules.push({
        record: `deliberation:${metric}:max`,
        expr: `max(${metric})`,
      });
      continue;
    }
    operationalRules.push({
      alert: pascal(alert.name),
      expr: `max(${metric}) > ${formatNumber(thresholdMs / 1000)}`,
      for: shortestWindow,
      labels: { severity: alert.severity, alert_rule: alert.name, objective: derived.objective },
      annotations: {
        summary: `${alert.name}: ${metric} exceeds ${formatNumber(thresholdMs / 1000)}s`,
        description: `Threshold derived from ${SLO_SOURCE} objectives.${derived.objective}.${derived.field}`
          + ` (${formatNumber(thresholdMs)}ms).`,
        source: `${ALERT_SOURCE} alerts.${alert.name}`,
      },
    });
  }

  /**
   * The zeroTolerance list is a set of correctness invariants, not availability numbers, so it
   * gets its own group with no burn-rate arithmetic: a single occurrence is the condition.
   */
  const zeroToleranceRules: PrometheusRule[] = slos.zeroTolerance.map((invariant) => {
    const name = requireName(invariant, SLO_SOURCE);
    return {
      alert: pascal('zero-tolerance', name),
      expr: `increase(${ZERO_TOLERANCE_TOTAL}{reason_code="${name}"}[${longestWindow}]) > 0`,
      for: '0s',
      labels: { severity: 'page', invariant: name, risk_tier: 'zero-tolerance' },
      annotations: {
        summary: `Zero-tolerance invariant violated: ${name}`,
        description: `${SLO_SOURCE} lists ${name} as zero tolerance; any single detected violation`
          + ' is a page, with no error budget and no burn-rate smoothing.',
        source: `${SLO_SOURCE} zeroTolerance`,
      },
    };
  });

  const groups: PrometheusRuleGroup[] = [
    { name: 'deliberation-sli-recording', rules: recording },
    { name: 'deliberation-error-budget-burn', rules: burnRules },
    { name: 'deliberation-latency-objectives', rules: latencyRules },
    { name: 'deliberation-slo-self-evaluation', rules: selfEvaluationRules },
    { name: 'deliberation-operational-alerts', rules: operationalRules },
    { name: 'deliberation-zero-tolerance', rules: zeroToleranceRules },
  ];
  return { groups: groups.filter((group) => group.rules.length > 0), warnings };
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`Non-finite numeric threshold: ${value}`);
  // Avoid exponent notation (1e-9) and float dust (0.0009999999999999): PromQL accepts both,
  // but neither reads well in a rule an operator has to review.
  return Number(value.toPrecision(12)).toString();
}

const PLAIN_SCALAR = /^[A-Za-z_][A-Za-z0-9_./:-]*$/;
const RESERVED_SCALARS = new Set(['true', 'false', 'null', 'yes', 'no', 'on', 'off', 'y', 'n']);

function scalar(value: string): string {
  if (PLAIN_SCALAR.test(value) && !RESERVED_SCALARS.has(value.toLowerCase())) return value;
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function emitMapping(lines: string[], indent: string, mapping: Readonly<Record<string, string>>): void {
  for (const [key, value] of Object.entries(mapping)) lines.push(`${indent}${key}: ${scalar(value)}`);
}

export function toYaml(generated: GeneratedRules): string {
  const lines: string[] = [
    '# Generated by scripts/generate-prometheus-rules.ts (ADR-048).',
    `# Source of truth: ${SLO_SOURCE}, ${ALERT_SOURCE}. Do not edit by hand.`,
  ];
  for (const warning of generated.warnings) lines.push(`# WARNING: ${warning}`);
  lines.push('groups:');
  for (const group of generated.groups) {
    lines.push(`  - name: ${scalar(group.name)}`);
    lines.push('    rules:');
    for (const rule of group.rules) {
      const head = rule.record !== undefined ? `record: ${scalar(rule.record)}` : `alert: ${scalar(rule.alert!)}`;
      lines.push(`      - ${head}`);
      lines.push(`        expr: ${scalar(rule.expr)}`);
      if (rule.for !== undefined) lines.push(`        for: ${scalar(rule.for)}`);
      if (rule.labels !== undefined && Object.keys(rule.labels).length > 0) {
        lines.push('        labels:');
        emitMapping(lines, '          ', rule.labels);
      }
      if (rule.annotations !== undefined && Object.keys(rule.annotations).length > 0) {
        lines.push('        annotations:');
        emitMapping(lines, '          ', rule.annotations);
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

export async function generate(argv: readonly string[]): Promise<void> {
  const outIndex = argv.indexOf('--out');
  const out = outIndex === -1 ? 'artifacts/prometheus-rules.yml' : argv[outIndex + 1];
  if (out === undefined || out.length === 0) throw new Error('--out requires a path (or "-" for stdout)');

  const slos = JSON.parse(await readFile(resolve(SLO_SOURCE), 'utf8')) as SloDocument;
  const alerts = JSON.parse(await readFile(resolve(ALERT_SOURCE), 'utf8')) as AlertDocument;
  const generated = buildRules(slos, alerts);
  const yaml = toYaml(generated);

  if (out === '-') {
    process.stdout.write(yaml);
  } else {
    const path = resolve(out);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, yaml, 'utf8');
    const ruleCount = generated.groups.reduce((sum, group) => sum + group.rules.length, 0);
    console.log(`Wrote ${ruleCount} Prometheus rules across ${generated.groups.length} groups to ${out}.`);
  }
  for (const warning of generated.warnings) console.warn(`WARNING: ${warning}`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await generate(process.argv.slice(2));
}
