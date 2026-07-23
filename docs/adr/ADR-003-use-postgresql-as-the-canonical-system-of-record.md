# ADR-003: Use PostgreSQL as the Canonical System of Record

- **Status**: proposed
- **Date**: 2026-07-23
- **Deciders**:
- **Tags**: data, postgresql, persistence

## Context

Decision contracts, policies, provenance, scoring, quotas, and audit metadata require transactional consistency, constraints, point-in-time recovery, tenant isolation, and mature operations. Vector memory cannot be the source of truth. Large encrypted artifacts and embeddings have different access characteristics.

## Decision

Use supported PostgreSQL as the canonical transactional store, with schema-per-context ownership, row-level tenant defense, optimistic concurrency, UTC timestamps, append-only audit/outbox tables, and expand-contract migrations. Use an S3-compatible encrypted object store for large immutable artifacts. Use a replaceable vector retrieval adapter for embeddings and branch overlays.

Canonical records store hashes and opaque object/vector references. Backups are encrypted, continuously verified, and restored in exercises. Search projections are rebuildable and never authoritative.

## Consequences

### Positive

- Mature integrity, recovery, query, and operational ecosystem.
- Clear separation between canonical state and derived retrieval structures.

### Negative

- Requires disciplined schema ownership, migration review, and connection management.
- High-volume branch payloads may need partitioning and archival.

### Neutral

- Managed and self-hosted deployments may use different compatible implementations.

## Links

- [ADR-005](./ADR-005-make-provenance-and-epistemic-classification-mandatory.md)
- [ADR-007](./ADR-007-isolate-branch-memory-behind-a-port.md)
- [ADR-012](./ADR-012-adopt-privacy-by-design-and-cryptographic-erasure.md)
