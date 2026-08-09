import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  buildRules,
  toYaml,
  type AlertDocument,
  type SloDocument,
} from '../../scripts/generate-prometheus-rules.js';

type YamlValue = string | YamlValue[] | { [key: string]: YamlValue };

/**
 * Minimal reader for the exact YAML subset the generator emits (block mappings, block
 * sequences, plain and double-quoted scalars). It is strict about indentation and quoting, so a
 * malformed emission fails here rather than silently parsing into something plausible.
 */
function parseYaml(source: string): YamlValue {
  const lines = source
    .split('\n')
    .filter((line) => line.trim().length > 0 && !line.trimStart().startsWith('#'));
  let cursor = 0;

  const indentOf = (line: string): number => line.length - line.trimStart().length;

  const readScalar = (raw: string): string => {
    const text = raw.trim();
    if (!text.startsWith('"')) {
      // A plain scalar may contain ':' only when not followed by whitespace, per the YAML spec.
      if (/"|:\s|:$/.test(text)) throw new Error(`Unquoted scalar needs quoting: ${text}`);
      return text;
    }
    if (!text.endsWith('"') || text.length < 2) throw new Error(`Unterminated quoted scalar: ${text}`);
    let out = '';
    for (let index = 1; index < text.length - 1; index += 1) {
      const character = text[index]!;
      if (character !== '\\') {
        if (character === '"') throw new Error(`Unescaped quote inside scalar: ${text}`);
        out += character;
        continue;
      }
      index += 1;
      const escaped = text[index];
      if (escaped !== '"' && escaped !== '\\') throw new Error(`Unsupported escape in scalar: ${text}`);
      out += escaped;
    }
    return out;
  };

  const parseBlock = (indent: number): YamlValue => {
    const first = lines[cursor];
    if (first === undefined) throw new Error('Unexpected end of document');
    if (first.trimStart().startsWith('- ')) {
      const items: YamlValue[] = [];
      while (cursor < lines.length) {
        const line = lines[cursor]!;
        if (indentOf(line) !== indent || !line.trimStart().startsWith('- ')) break;
        const inline = line.trimStart().slice(2);
        // A sequence item that opens a mapping is re-read as a mapping starting at this column.
        lines[cursor] = `${' '.repeat(indent + 2)}${inline}`;
        items.push(parseBlock(indent + 2));
      }
      return items;
    }
    const mapping: Record<string, YamlValue> = {};
    while (cursor < lines.length) {
      const line = lines[cursor]!;
      const lineIndent = indentOf(line);
      if (lineIndent < indent) break;
      if (lineIndent > indent) throw new Error(`Unexpected indentation at: ${line}`);
      if (line.trimStart().startsWith('- ')) break;
      const separator = line.indexOf(': ');
      const isEmptyKey = line.trimEnd().endsWith(':') && (separator === -1 || line.indexOf(':') < separator);
      if (isEmptyKey) {
        const key = line.trim().slice(0, -1);
        cursor += 1;
        if (key in mapping) throw new Error(`Duplicate key: ${key}`);
        const next = lines[cursor];
        if (next === undefined || indentOf(next) <= indent) throw new Error(`Empty block for key: ${key}`);
        mapping[key] = parseBlock(indentOf(next));
        continue;
      }
      if (separator === -1) throw new Error(`Malformed mapping line: ${line}`);
      const key = line.slice(0, separator).trim();
      if (key in mapping) throw new Error(`Duplicate key: ${key}`);
      mapping[key] = readScalar(line.slice(separator + 2));
      cursor += 1;
    }
    return mapping;
  };

  const document = parseBlock(indentOf(lines[0]!));
  if (cursor !== lines.length) throw new Error(`Trailing content at line ${cursor}`);
  return document;
}

interface ParsedRule {
  readonly record?: string;
  readonly alert?: string;
  readonly expr: string;
  readonly for?: string;
  readonly labels?: Record<string, string>;
  readonly annotations?: Record<string, string>;
}

function parseRuleFile(yaml: string): { name: string; rules: ParsedRule[] }[] {
  const document = parseYaml(yaml) as unknown as { groups: { name: string; rules: ParsedRule[] }[] };
  expect(Array.isArray(document.groups)).toBe(true);
  return document.groups;
}

const realSlos = JSON.parse(await readFile('config/operations/slos.json', 'utf8')) as SloDocument;
const realAlerts = JSON.parse(await readFile('config/operations/alerts.json', 'utf8')) as AlertDocument;

describe('Prometheus rule generation', () => {
  const generated = buildRules(realSlos, realAlerts);
  const groups = parseRuleFile(toYaml(generated));
  const allRules = groups.flatMap((group) => group.rules);

  it('round-trips to a well-formed rule document with the Prometheus group/rule shape', () => {
    expect(groups.length).toBe(generated.groups.length);
    for (const group of groups) {
      expect(typeof group.name).toBe('string');
      expect(group.rules.length).toBeGreaterThan(0);
      for (const rule of group.rules) {
        expect(typeof rule.expr).toBe('string');
        expect(rule.expr.length).toBeGreaterThan(0);
        // Exactly one of record/alert, as Prometheus requires.
        expect([rule.record, rule.alert].filter((value) => value !== undefined)).toHaveLength(1);
        if (rule.alert !== undefined) expect(rule.annotations?.['summary']).toBeTruthy();
        if (rule.for !== undefined) expect(rule.for).toMatch(/^\d+[smhdw]$/);
      }
    }
    expect(new Set(groups.map((group) => group.name)).size).toBe(groups.length);
    const named = allRules.map((rule) => rule.record ?? rule.alert!);
    expect(new Set(named).size).toBe(named.length);
  });

  it('emits at least one rule for every declared objective', () => {
    for (const objective of Object.keys(realSlos.objectives)) {
      const matching = allRules.filter((rule) => rule.labels?.['objective'] === objective);
      expect(matching.length, `no rule generated for objective ${objective}`).toBeGreaterThan(0);
    }
  });

  it('emits at least one rule for every declared alert', () => {
    for (const alert of realAlerts.alerts) {
      const byRule = allRules.filter((rule) => rule.labels?.['alert_rule'] === alert.name);
      const byRecording = alert.metric === undefined
        ? []
        : allRules.filter((rule) => rule.record === `deliberation:${alert.metric}:max`);
      expect(byRule.length + byRecording.length, `no rule generated for alert ${alert.name}`).toBeGreaterThan(0);
      for (const rule of byRule) expect(rule.labels?.['severity']).toBe(alert.severity);
    }
  });

  it('emits one page-severity rule per zero-tolerance invariant, with no burn-rate arithmetic', () => {
    const zeroTolerance = groups.find((group) => group.name === 'deliberation-zero-tolerance')!;
    expect(zeroTolerance.rules).toHaveLength(realSlos.zeroTolerance.length);
    for (const invariant of realSlos.zeroTolerance) {
      const rule = zeroTolerance.rules.find((candidate) => candidate.labels?.['invariant'] === invariant)!;
      expect(rule.labels?.['severity']).toBe('page');
      expect(rule.expr).toBe(
        `increase(deliberation_zero_tolerance_violations_total{reason_code="${invariant}"}[1h]) > 0`,
      );
    }
  });

  it('builds burn-rate expressions from the real objective and burn rate', () => {
    const burn = groups.find((group) => group.name === 'deliberation-error-budget-burn')!;
    const fast = burn.rules.find((rule) => rule.alert === 'FastErrorBudgetBurnCommandApi')!;
    // command-api targets 99.9% availability, so the budget is 0.001 and 14.4x burn is 0.0144.
    expect(fast.expr).toBe(
      'deliberation:operation_error:ratio_rate5m{operation="command-api"} > 14.4 * 0.001',
    );
    expect(fast.for).toBe('5m');
    expect(fast.labels?.['severity']).toBe('page');

    const slow = burn.rules.find((rule) => rule.alert === 'SlowErrorBudgetBurnAuthorization')!;
    expect(slow.expr).toBe(
      'deliberation:operation_error:ratio_rate1h{operation="authorization"} > 6 * 0.0001',
    );
    expect(slow.labels?.['severity']).toBe('ticket');
  });

  it('references only metric names the platform actually emits', () => {
    const recorded = new Set(allRules.flatMap((rule) => (rule.record === undefined ? [] : [rule.record])));
    const known = new Set([
      'deliberation_operations_total',
      'deliberation_operation_duration_ms_bucket',
      'deliberation_security_rejections_total',
      'deliberation_slo_met',
      'deliberation_zero_tolerance_violations_total',
      // Declared in alerts.json against an adopter-supplied metric.
      ...realAlerts.alerts.flatMap((alert) => (alert.metric === undefined ? [] : [alert.metric])),
    ]);
    const keywords = new Set(['rate', 'increase', 'sum', 'max', 'by', 'le', 'histogram_quantile', 'operation', 'reason_code', 'outcome']);
    for (const rule of allRules) {
      for (const [identifier] of rule.expr.matchAll(/(?<![:\w])([a-z_][a-z0-9_]*)(?=[{[\s),]|$)/g)) {
        if (keywords.has(identifier)) continue;
        expect(known.has(identifier), `unknown metric ${identifier} in ${rule.expr}`).toBe(true);
      }
      // Every recording-rule reference must be satisfied by a recording rule this file defines.
      for (const [reference] of rule.expr.matchAll(/deliberation:[a-z0-9_]+:[a-z0-9_]+/g)) {
        expect(recorded.has(reference), `dangling recording-rule reference ${reference}`).toBe(true);
      }
    }
    expect(allRules.some((rule) => rule.expr.includes('deliberation:operation_error:ratio_rate5m'))).toBe(true);
  });

  it('translates the audit-sealing-lag threshold from the SLO rather than inventing one', () => {
    const rule = allRules.find((candidate) => candidate.alert === 'AuditSealingLag')!;
    // audit-sealing.maximumMs is 300000ms, so the gauge bound is 300 seconds.
    expect(rule.expr).toBe('max(audit_sealing_lag_seconds) > 300');
    expect(rule.labels?.['objective']).toBe('audit-sealing');
  });

  it('warns and emits only a recording rule where no threshold is declared or derivable', () => {
    expect(generated.warnings.map((warning) => warning.split(':')[0])).toEqual(['workflow-stuck', 'queue-age']);
    expect(allRules.some((rule) => rule.record === 'deliberation:workflow_state_age_seconds:max')).toBe(true);
    expect(allRules.some((rule) => rule.alert === 'WorkflowStuck')).toBe(false);
  });

  it('quotes scalars that would otherwise reparse as a different type', () => {
    const yaml = toYaml(buildRules(
      { version: 1, objectives: { on: { availability: 0.5 } }, zeroTolerance: [] },
      { version: 1, alerts: [{ name: 'burn', window: '5m', burnRate: 2, severity: 'page' }] },
    ));
    expect(yaml).toContain('objective: "on"');
    expect(parseRuleFile(yaml).flatMap((group) => group.rules).some((rule) => rule.labels?.['objective'] === 'on'))
      .toBe(true);
  });

  it('rejects declarations that would inject arbitrary text into PromQL', () => {
    expect(() => buildRules(
      { version: 1, objectives: { 'bad"} or up{': { availability: 0.9 } }, zeroTolerance: [] },
      realAlerts,
    )).toThrow(/invalid objective/);
    expect(() => buildRules(realSlos, {
      version: 1,
      alerts: [{ name: 'x', window: '5m]) or up or (rate(x[5m', burnRate: 2, severity: 'page' }],
    })).toThrow(/invalid Prometheus duration/);
    expect(() => buildRules(realSlos, {
      version: 1,
      alerts: [...realAlerts.alerts, { name: 'x', metric: 'evil{a="b"}', severity: 'page' }],
    })).toThrow(/invalid metric name/);
    expect(() => buildRules({ ...realSlos, version: 2 }, realAlerts)).toThrow(/unsupported version/);
  });
});
