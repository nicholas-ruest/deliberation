# ADR-004: Use Transactional Outbox and Durable Workflows

- **Status**: proposed
- **Date**: 2026-07-23
- **Deciders**:
- **Tags**: events, workflow, reliability

## Context

Planning, evaluation, erasure, connector calls, and learning promotion cross aggregate boundaries and include long-running or fallible external work. Distributed transactions are unavailable; best-effort in-process events lose work and duplicate side effects.

## Decision

Write domain state and outbox messages in one PostgreSQL transaction. Relay versioned integration events at least once; consumers are idempotent and maintain inbox/deduplication records. Use a durable workflow engine or persisted state machine for multi-step sagas, timers, retries, cancellation, and compensation.

Every workflow defines timeout, retry classification with jitter, idempotency key, compensation, dead-letter policy, operator repair path, and correlation/causation IDs. No workflow depends on exactly-once transport.

## Consequences

### Positive

- Recoverable long-running operations and auditable cross-context behavior.
- Safe retries and controlled compensation for quota, run, publication, and erasure workflows.

### Negative

- Eventual consistency and duplicate-delivery complexity become explicit.
- Workflow/event schema evolution requires governance and tests.

### Neutral

- The initial queue/workflow product is selected by an implementation spike and can be replaced behind ports.

## Links

- [ADR-002](./ADR-002-use-a-domain-aligned-modular-monolith-first.md)
- [ADR-014](./ADR-014-publish-contract-first-apis-and-versioned-events.md)
- [ADR-015](./ADR-015-operate-with-slos-open-telemetry-and-disaster-recovery.md)
