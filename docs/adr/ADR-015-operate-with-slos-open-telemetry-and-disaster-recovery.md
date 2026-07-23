# ADR-015: Operate with SLOs, OpenTelemetry, and Disaster Recovery

- **Status**: proposed
- **Date**: 2026-07-23
- **Deciders**:
- **Tags**: sre, observability, disaster-recovery

## Context

Long-running AI workflows fail differently from ordinary requests: queue delay, provider throttling, partial branches, budget exhaustion, schema drift, and late results. Enterprise viability requires measurable reliability, cost, auditability, and tested recovery without logging customer content.

## Decision

Define service-tier SLIs/SLOs for API availability/latency, queue age, run completion/cancellation, brief publication, connector success, authorization, and erasure completion. Use OpenTelemetry traces, metrics, and structured logs joined by tenant-safe correlation IDs. Record model/tool usage and workflow state as metrics; customer prompts/evidence are excluded from telemetry by default.

Operate error budgets, paging on actionable symptoms, runbooks, synthetic probes, capacity forecasts, per-tenant fairness, and provider health routing. Use multi-AZ stateful services, point-in-time database recovery, versioned object storage, infrastructure as code, immutable releases, and tested RPO/RTO. Conduct quarterly restore and annual regional-failure exercises before contractual claims.

## Consequences

### Positive

- Evidence-based reliability, faster incident response, and defensible enterprise SLAs.
- Cost/quality/latency can be diagnosed per workflow stage without exposing content.

### Negative

- Significant platform engineering and telemetry-governance investment.
- SLOs constrain rapid provider or architecture changes.

### Neutral

- Initial numeric targets are set after load tests and revised through error-budget policy.

## Links

- [ADR-004](./ADR-004-use-transactional-outbox-and-durable-workflows.md)
- [ADR-006](./ADR-006-use-budgeted-central-orchestration-and-isolated-workers.md)
- [ADR-018](./ADR-018-require-evidence-based-release-quality-gates.md)
