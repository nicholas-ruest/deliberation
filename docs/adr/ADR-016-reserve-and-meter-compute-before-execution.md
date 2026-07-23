# ADR-016: Reserve and Meter Compute Before Execution

- **Status**: proposed
- **Date**: 2026-07-23
- **Deciders**:
- **Tags**: billing, quota, finops

## Context

Model/tool cost scales with branches and depth. Post-hoc billing cannot prevent runaway spend, noisy-neighbor impact, or provider-budget breach. Enterprise plans require predictable entitlements and content-free usage evidence.

## Decision

Before a scenario tree starts, estimate and reserve its maximum policy/plan-approved budget across tokens, money, tool calls, branches, time, and concurrency. The orchestrator decrements local budgets and emits idempotent usage entries; reconciliation consumes actual usage and releases unused reservation.

Enforce tenant and platform hard limits, concurrency fairness, anomaly detection, alerts, and graceful budget exhaustion. Meter only technical dimensions and opaque resource IDs—never deliberation content. Governance denial overrides paid entitlement. Billing-provider webhooks are reconciled into internal entitlements rather than trusted as ordered commands.

## Consequences

### Positive

- Predictable margins, customer controls, and protection against runaway agents.
- Supports trials, quotas, overages, contract limits, and internal chargeback.

### Negative

- Estimates may reserve too much or stop useful runs early.
- Reconciliation, provider price catalogs, and dispute tooling are required.

### Neutral

- Customers may choose fixed, capped usage, or approved overage plans.

## Links

- [ADR-006](./ADR-006-use-budgeted-central-orchestration-and-isolated-workers.md)
- [Commercial aggregate](../ddd/aggregate-catalog.md#entitlement)
- [ADR-015](./ADR-015-operate-with-slos-open-telemetry-and-disaster-recovery.md)
