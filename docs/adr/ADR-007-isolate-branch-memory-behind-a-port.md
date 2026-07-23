# ADR-007: Isolate Branch Memory Behind a Port

- **Status**: proposed
- **Date**: 2026-07-23
- **Deciders**:
- **Tags**: memory, agenticow, portability

## Context

Agenticow provides useful copy-on-write vector overlays but is young, platform-constrained, and does not represent full agent or canonical state. Hard-coding it into domain objects would confuse storage optimization with domain truth and create vendor lock-in.

## Decision

Define a `BranchMemoryPort` for create, overlay read/write, tombstone, diff, discard, and approved promotion. Implement both a PostgreSQL/object delta baseline and an agenticow adapter. Canonical state, provenance, budgets, branch lineage, and domain events remain in PostgreSQL.

Promotion accepts typed, independently verified deltas only; it never merges an opaque generated memory wholesale. Adapters must pass isolation, lineage, deletion, crash-recovery, tenant-separation, recall, portability, and benchmark contract tests. Agenticow is enabled only where its measured benefit exceeds operational cost.

## Consequences

### Positive

- Captures COW benefits without betting the product on one library.
- Enables honest benchmark comparison and platform fallback.

### Negative

- Lowest-common-denominator port may not expose every backend optimization.
- Dual adapter testing and migration tooling cost engineering time.

### Neutral

- Branch metadata size is an infrastructure metric, not a product accuracy claim.

## Links

- [ADR-003](./ADR-003-use-postgresql-as-the-canonical-system-of-record.md)
- [ADR-006](./ADR-006-use-budgeted-central-orchestration-and-isolated-workers.md)
- [Research dependency assessment](../../.plans/deliberation-deep-research.md#agenticow)
