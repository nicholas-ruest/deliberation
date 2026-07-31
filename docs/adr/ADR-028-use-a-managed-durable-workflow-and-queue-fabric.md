# ADR-028: Use a Managed Durable Workflow and Queue Fabric

- **Status**: proposed
- **Date**: 2026-07-31
- **Deciders**:
- **Tags**: workflows, queues, outbox, workers, delivery

## Context

The current worker is only a process loop and workflow/outbox stores are in-memory references. Production planning, erasure, publication, reconciliation, imports, and learning promotion must survive restarts and infrastructure failure while preserving cancellation, fencing, compensation, and tenant fairness.

## Decision

Adopt a managed durable workflow service behind the existing workflow port and a managed at-least-once queue/event service for integration delivery. The exact provider is replaceable, but the first production selection must pass the contracts below before use.

Canonical domain state and transactional outbox rows commit together in PostgreSQL. A relay publishes outbox records with stable event IDs. Consumers use durable inbox/deduplication records. Transport acknowledgment never substitutes for the domain commit, and no component claims exactly-once transport.

Long-running workflows persist versioned state, timers, retry class, compensation progress, cancellation state, deadlines, and repair history. Workflow code is deterministic or isolates non-determinism in activities. Deployment retains compatible workers for in-flight workflow versions or performs an explicit migration.

Workers use tenant-bound, generation-fenced leases and short-lived capability tokens. Queue partitions, concurrency pools, and admission control prevent one tenant from exhausting the cell. Dead letters are encrypted, content-minimized, observable, and repairable only through audited operator workflows.

## Consequences

- Workflow and message schemas become long-lived production contracts.
- Duplicate, delayed, and reordered messages remain normal operating conditions.
- Provider outage can pause progress but cannot corrupt canonical state or lose accepted cancellation.

## Rejected alternatives

- **In-memory loops**: lose progress and timers on restart.
- **Database polling as the permanent execution fabric**: creates contention and weak operational isolation.
- **Peer-to-peer worker coordination**: violates central budgets and anti-drift constraints.

## Acceptance evidence

- Crash injection at every commit/publish/ack boundary proves no lost committed work.
- Duplicate, reordered, delayed, and poison messages do not duplicate effects.
- Workflow upgrade, retry, timeout, cancellation, compensation, dead-letter, and repair tests pass.
- Broker/workflow outage and recovery stay within queue-age and cancellation objectives.
- Noisy-neighbor tests demonstrate tenant and platform concurrency fairness.

## Links

- [ADR-004](./ADR-004-use-transactional-outbox-and-durable-workflows.md)
- [ADR-006](./ADR-006-use-budgeted-central-orchestration-and-isolated-workers.md)
- [ADR-016](./ADR-016-reserve-and-meter-compute-before-execution.md)
