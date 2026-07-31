# ADR-022: Use Cell-Based Failure Isolation and Admission Control

- **Status**: proposed
- **Date**: 2026-07-30
- **Deciders**:
- **Tags**: resilience, tenancy, capacity, reliability

## Context

Scenario planning can create bursty, expensive work and depends on fallible model, tool, identity, billing, and storage providers. Horizontal scaling alone does not prevent a large tenant, poison workflow, provider outage, or retry storm from exhausting shared capacity.

## Decision

Assign each tenant to a regional workload cell containing bounded API, worker, queue, projection, and provider-capacity partitions. Global control-plane services store routing and non-content administration; tenant content and execution remain in the assigned data region. Cell assignment is explicit and auditable. Cell movement is a governed migration with quiescence, copy verification, cutover, rollback, and residency checks.

Apply admission control before durable work starts. It evaluates tenant status, risk policy, entitlement reservation, regional/cell capacity, queue-age objective, provider capacity, and per-tenant concurrency. Accepted work receives a capacity lease; rejected work returns a typed retryable or terminal reason. Interactive, cancellation, security, erasure, and recovery traffic have protected capacity and cannot be starved by batch planning.

Use bulkheads per tenant, workload class, connector, and model provider; bounded queues; deadlines propagated end to end; retry budgets with exponential backoff and jitter; circuit breakers; concurrency limits; and dead-letter quarantine with controlled replay. Retries require idempotency and may not exceed the original financial or time budget.

Graceful degradation preserves read/export/cancel/security operations, offers lower-cost approved routes where policy permits, and abstains when required verification is unavailable. It never silently drops provenance, weakens hard constraints, crosses residency, or uses an unapproved provider.

Autoscaling uses queue age, service time, reserved work, and provider limits rather than CPU alone. Capacity forecasts and overload drills determine headroom. A cell failure limits blast radius; restoration and any regional failover follow tenant policy and declared RTO/RPO.

## Consequences

### Positive

- Limits noisy-neighbor and provider-failure blast radius while protecting critical control paths.
- Connects commercial reservations to real capacity rather than aspirational quotas.

### Negative

- Adds routing, cell migration, capacity planning, and fairness complexity.
- Some accepted work will wait or be rejected during constrained capacity.

### Neutral

- A first release may operate one cell per region if cell boundaries and routing contracts are preserved.

## Acceptance evidence

- Overload, retry-storm, poison-message, provider-outage, cell-loss, and noisy-neighbor exercises pass.
- Protected control traffic remains within its SLO during planning saturation.
- Admission and capacity decisions reconcile with reservation and usage ledgers.
- Degradation tests prove that safety, provenance, tenancy, and residency controls remain enforced.

## Links

- [ADR-006](./ADR-006-use-budgeted-central-orchestration-and-isolated-workers.md)
- [ADR-015](./ADR-015-operate-with-slos-open-telemetry-and-disaster-recovery.md)
- [ADR-016](./ADR-016-reserve-and-meter-compute-before-execution.md)
- [Operational model](../ddd/operational-model.md)
