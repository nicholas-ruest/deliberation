# ADR-021: Build Owned Projections, Search, and Caches from Canonical Events

- **Status**: proposed
- **Date**: 2026-07-30
- **Deciders**:
- **Tags**: data, cqrs, search, cache

## Context

Aggregate stores are optimized for invariant-preserving writes, not dashboards, full-text retrieval, analytics, or low-latency lists. Allowing arbitrary joins, shared search indexes, or caches to become authoritative would break bounded-context ownership, tenant isolation, erasure, and reproducibility.

## Decision

Use a CQRS-lite model: each bounded context owns its write model and may build purpose-specific projections from its own committed events or published contracts. Projections, full-text indexes, vector indexes, analytics stores, and caches are disposable derivatives and never authorize commands or establish canonical facts.

Every projection declares its source event versions, schema version, tenant and purpose partitioning, freshness SLI, rebuild procedure, retention behavior, and checkpoint. Consumers process at least once with idempotent handlers. Rebuilds use an immutable source watermark and atomically switch aliases only after count, digest, and sampling validation.

Queries declare a consistency class:

- `strong`: read the owning transactional store;
- `read-your-writes`: use a session watermark and wait or fall back to the owner;
- `bounded-stale`: return projection watermark and maximum accepted lag;
- `eventual`: return current projection watermark.

Cache keys always include tenant, authorization-relevant scope, resource version, and purpose where applicable. Revocation, sensitivity restriction, consent withdrawal, supersession, and erasure invalidate or make entries unreachable before the command is acknowledged when policy requires immediate effect.

Search results retain source IDs, versions, epistemic class, sensitivity, purpose, and provenance. Retrieval filters are enforced before ranking and again before response construction. Embeddings are derived data: models and dimensions are versioned, secret/forbidden fields are excluded, and erasure covers vectors and index tombstones.

Cross-context reporting consumes published events into an analytics boundary; it does not join operational schemas. Customer content is excluded from product analytics by default.

## Consequences

### Positive

- Supports responsive enterprise UX and rebuildable search without weakening domain ownership.
- Makes staleness and authorization behavior explicit.

### Negative

- Requires projection versioning, replay capacity, invalidation paths, and lag monitoring.
- Read-after-write behavior must be designed per query.

### Neutral

- PostgreSQL projections may be sufficient initially; dedicated search or analytics engines require measured need.

## Acceptance evidence

- Full rebuild, rolling schema change, duplicate event, out-of-order event, and poison-message tests pass.
- Projection lag and read-your-writes behavior meet declared SLOs.
- Revocation and erasure tests prove stale caches/indexes cannot disclose restricted content.
- Search returns traceable source versions and never broadens tenant or purpose scope.

## Links

- [ADR-003](./ADR-003-use-postgresql-as-the-canonical-system-of-record.md)
- [ADR-004](./ADR-004-use-transactional-outbox-and-durable-workflows.md)
- [ADR-007](./ADR-007-isolate-branch-memory-behind-a-port.md)
- [Data and projections](../ddd/data-and-projection-contracts.md)
