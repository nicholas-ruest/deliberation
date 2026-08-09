# ADR-048: Evaluate SLOs and Alerts at Runtime, Not Just Declare Them

- **Status**: proposed
- **Date**: 2026-08-09
- **Deciders**:
- **Tags**: observability, slo, alerting

## Context

`config/operations/slos.json` declares real, specific objectives (`command-api` 99.9% availability,
`authorization` p99 100ms, a `zeroTolerance` list including `cross-tenant-disclosure` and
`audit-loss`). `config/operations/alerts.json` declares real alert rules (`fast-error-budget-burn`
at a 14.4 burn rate over 5 minutes, `workflow-stuck`, `queue-age`). `src/platform/observability/
telemetry.ts` even implements the math — `evaluateSli()` computes availability and p95/p99 from a
window and reports whether it meets a stated objective. None of this is connected to anything that
runs. `Telemetry.operation()` (ADR-033) emits real spans and counters when an OTel exporter is
configured, but nothing consumes those metrics, evaluates them against `slos.json`'s numbers, or
fires an alert from `alerts.json`'s rules. The declarative files and the evaluation function are
both real; the pipe between them and a running process does not exist.

## Decision

1. **Adopters own the metrics backend; this repository owns the rule translation.** Consistent
   with ADR-033/034's "we don't operate anyone's infrastructure" boundary, this platform does not
   ship or run Prometheus/Alertmanager/Grafana. What it can and should ship is a translation layer:
   a script or small module that reads `config/operations/slos.json` and `alerts.json` and emits
   the corresponding rule definitions in a standard, importable format (Prometheus recording/alert
   rule YAML is the natural target, given `@opentelemetry/exporter-metrics-otlp-http` is already a
   dependency and OTLP-to-Prometheus is a common adopter path) — so the numbers in this repository
   are the numbers that actually page someone, not a second, hand-copied set an adopter maintains
   separately and can silently drift from the source of truth.
2. **`evaluateSli()` gets a real caller.** Add a lightweight, opt-in self-evaluation loop (mirroring
   `bootstrapTelemetry`'s "registers real providers when configured, safe no-op otherwise" pattern,
   ADR-033) that periodically evaluates recent operation outcomes against `slos.json`'s objectives
   in-process and emits the result as its own metric (`deliberation.slo.met` with the objective name
   as an attribute) — giving an adopter without a full Prometheus rule pipeline still-real,
   still-exported evidence of SLO compliance, not just raw operation counters they'd have to
   compute this from themselves.
3. **The `zeroTolerance` list gets a distinct, louder path.** `cross-tenant-disclosure`,
   `incorrect-authorization-allow`, `silent-provenance-loss`, `audit-loss`, and
   `unmetered-paid-effect` are not availability numbers — they are correctness invariants that
   should never happen at all. These are not well-served by the same burn-rate alerting as
   availability SLOs; they get their own zero-tolerance detectors (e.g., an outbox/audit-ledger
   consistency check comparing expected vs. actual sealed records) rather than being silently
   folded into the same generic evaluation loop as item 2.
4. **This closes half of ADR-047's dependency.** Load/soak/chaos testing (ADR-047) needs something
   real to assert pass/fail against; this ADR is what makes `slos.json`'s numbers assertable
   outside of a human reading a dashboard.

## Consequences

### Positive

- The SLO/alert JSON stops being aspirational documentation and becomes the actual source of truth
  for both self-reported compliance metrics and (for adopters running Prometheus) real alert rules.
- Reuses `evaluateSli()` rather than building parallel evaluation logic — the math this repository
  already wrote and unit-tested finally has a caller.

### Negative

- The rule-translation layer (item 1) commits to Prometheus's rule format as the primary export
  target; an adopter on a different metrics stack (Datadog, CloudWatch) gets no equivalent
  translation without further work.
- Self-evaluation (item 2) adds a periodic in-process computation over recent operation history,
  which needs its own bounded memory/retention design (a sliding window, not an unbounded log) to
  avoid becoming its own resource-growth problem — the same class of concern ADR-034 already
  handles for the replay store and rate limiter via opportunistic cleanup.

### Neutral

- This ADR does not change any SLO target or alert threshold in `slos.json`/`alerts.json`; it only
  makes the existing numbers actually load-bearing.

## Links

- [ADR-015](./ADR-015-operate-with-slos-open-telemetry-and-disaster-recovery.md)
- [ADR-019](./ADR-019-use-a-tamper-evident-audit-ledger.md)
- [ADR-033](./ADR-033-wire-built-capabilities-into-the-runtime-path-with-fail-closed-defaults.md)
- [ADR-034](./ADR-034-close-multi-replica-and-attack-surface-gaps-in-the-wired-runtime.md)
- [ADR-047](./ADR-047-add-load-soak-and-chaos-testing.md)
