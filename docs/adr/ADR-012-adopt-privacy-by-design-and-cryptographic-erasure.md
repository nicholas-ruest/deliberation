# ADR-012: Adopt Privacy by Design and Cryptographic Erasure

- **Status**: proposed
- **Date**: 2026-07-23
- **Deciders**:
- **Tags**: privacy, encryption, retention

## Context

Decision data can reveal health, finance, employment, strategy, relationships, and inferred vulnerabilities. Derived branches, embeddings, prompts, logs, caches, exports, learning cohorts, and backups expand the data footprint. Simple row deletion is insufficient.

## Decision

Minimize collection and bind processing to declared purposes. Classify data at ingest; enforce configurable regional storage, retention, export, and legal hold. Encrypt in transit and at rest, using tenant-scoped envelope encryption for sensitive artifacts and managed key rotation. Provider calls obey tenant data-use and residency policy.

Governed erasure discovers canonical data, blobs, projections, indexes, branch deltas, caches, exports, learning membership, and backups. It deletes immediately where possible, applies access-denying key destruction/crypto-erasure where appropriate, records legal-hold exceptions, and emits signed completion evidence. Customer content is excluded from cross-customer training by default.

Conduct privacy impact assessments for applicable use cases and design meaningful human review/challenge paths where the platform influences decisions about people.

## Consequences

### Positive

- Strong enterprise privacy posture and verifiable lifecycle control.
- Limits blast radius and supports jurisdictional requirements.

### Negative

- Key management, backup expiry, lineage discovery, and regional operations are costly.
- Erasure can reduce reproducibility and learning datasets.

### Neutral

- Exact legal obligations remain jurisdiction/use-case specific and require counsel.

## Links

- [ADR-003](./ADR-003-use-postgresql-as-the-canonical-system-of-record.md)
- [ADR-005](./ADR-005-make-provenance-and-epistemic-classification-mandatory.md)
- [ADR-013](./ADR-013-restrict-learning-to-observed-outcomes-and-gated-promotion.md)
