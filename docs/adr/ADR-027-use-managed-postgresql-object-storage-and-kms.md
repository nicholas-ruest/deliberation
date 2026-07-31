# ADR-027: Use a Managed Regional Data Plane

- **Status**: proposed
- **Date**: 2026-07-31
- **Deciders**:
- **Tags**: postgresql, object-storage, kms, backup, data-plane

## Context

The demo uses in-memory adapters and optional local PostgreSQL tests. Production needs durable canonical state, encrypted artifacts, context-owned schemas, tenant isolation, backup/restore, connection management, and key lifecycle without turning caches or vectors into authoritative state.

## Decision

Each production cell uses a managed PostgreSQL service as its canonical transactional store, a managed S3-compatible object store for immutable large artifacts, and a managed KMS/HSM boundary for envelope-encryption and signing keys. Services are accessed only through workload identity and private networking.

PostgreSQL uses separate migration and runtime roles. Runtime roles cannot bypass row-level security or read another context's schema. A transaction-scoped tenant/principal context is mandatory. Connection pooling is bounded and transaction-compatible. Migrations use expand/backfill/verify/contract phases; destructive contract steps require a separately authorized release after compatibility evidence.

Object keys contain opaque tenant/cell partitions, never customer text. Every object has a content hash, encryption-key reference, sensitivity, purpose, retention policy, and canonical owner. Direct bucket access is unavailable to application users.

Backups, WAL/archive logs, object versions, and key metadata are encrypted, immutable for their retention window, region compliant, and included in erasure/no-resurrection procedures. Recovery is accepted only after a quarantined restore verifies RPO/RTO, RLS, hashes, audit continuity, projection rebuilds, and erased-data handling.

## Consequences

- The production application must replace in-memory repositories with contract-tested adapters.
- Availability and recovery depend on managed-service quotas and documented degradation behavior.
- Key loss is data loss; key administration requires separation of duties and tested recovery.

## Rejected alternatives

- **Application-managed PostgreSQL in the workload cluster**: adds avoidable database operations risk.
- **One shared unowned schema**: violates bounded-context ownership.
- **Vector database as source of truth**: cannot preserve canonical invariants or auditable migrations.

## Acceptance evidence

- Repository contracts and concurrency tests pass against the production engine/version.
- RLS tests fail cross-tenant access even when application filters are absent.
- KMS rotation, revocation, and cryptographic-erasure exercises pass without plaintext key exposure.
- Point-in-time and object restore drills meet RPO/RTO and prove no erased data becomes accessible.
- Connection exhaustion and managed-service failover produce bounded, observable behavior.

## Links

- [ADR-003](./ADR-003-use-postgresql-as-the-canonical-system-of-record.md)
- [ADR-012](./ADR-012-adopt-privacy-by-design-and-cryptographic-erasure.md)
- [ADR-021](./ADR-021-build-owned-projections-search-and-caches-from-canonical-events.md)
