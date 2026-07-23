# ADR-006: Use Budgeted Central Orchestration and Isolated Workers

- **Status**: proposed
- **Date**: 2026-07-23
- **Deciders**:
- **Tags**: agents, orchestration, cost-control

## Context

Parallel search can improve coverage, but cost grows with rollout count and depth. A decentralized mesh adds trust and consistency problems without improving world-model validity. Unbounded autonomous loops are commercially and operationally unsafe.

## Decision

Use a central durable orchestrator and horizontally scalable, stateless, sandboxed workers. A `ScenarioTree` freezes inputs and receives explicit limits for branches, depth, tokens, money, wall-clock time, tool calls, and concurrency. Workers acquire expiring leases and commit steps idempotently. Cancellation stops new leases and rejects late commits.

Default search is adaptive and bounded: start with 8–16 deliberately diverse branches, prune dominated/duplicative paths, and expand uncertainty or expected information value. Same-model samples are labeled correlated. No peer-to-peer Synaptic-Mesh production dependency is accepted without a new measured-requirement ADR.

## Consequences

### Positive

- Predictable cost, observability, cancellation, and tenant fairness.
- Straightforward worker isolation and reproducible scheduling.

### Negative

- Orchestrator and queue are critical infrastructure.
- Central scheduling may eventually limit specialized edge deployments.

### Neutral

- Worker roles can use heterogeneous models/tools without becoming permanent autonomous identities.

## Links

- [ADR-016](./ADR-016-reserve-and-meter-compute-before-execution.md)
- [ADR-007](./ADR-007-isolate-branch-memory-behind-a-port.md)
- [ADR-015](./ADR-015-operate-with-slos-open-telemetry-and-disaster-recovery.md)
