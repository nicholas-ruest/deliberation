# ADR-025: Guarantee Versioned Data Portability and Interoperability

- **Status**: proposed
- **Date**: 2026-07-30
- **Deciders**:
- **Tags**: portability, export, import, interoperability

## Context

Commercially credible enterprise software must avoid trapping customers in opaque prompts, vectors, provider-specific payloads, or rendered briefs. Customers need verifiable exports for continuity, legal duties, analytics, migration, and disaster scenarios, while imports must not smuggle untrusted state into canonical records.

## Decision

Define a versioned, provider-neutral Deliberation Exchange Package (DXP). A package may contain decision contracts, preference snapshots, evidence metadata and permitted content, scenario lineage and manifests, evaluation findings, briefs, human decisions, outcome records, audit subsets, and configuration/policy references. It excludes secrets, credentials, internal authorization material, provider chain-of-thought, and data outside the requester’s tenant, purpose, and export grant.

Each package contains a machine-readable manifest with schema versions, tenant/export scope, creation and expiry times, record counts, content hashes, provenance links, encryption metadata, omitted/redacted fields with reasons, and a detached platform signature. Large exports are asynchronous, resumable, encrypted to a customer key or short-lived download key, malware scanned, rate limited, and automatically expired. Export generation uses a consistent watermark and records post-watermark changes.

Imports land in quarantine. They are authenticated, size limited, decompressed safely, schema validated, malware/content scanned, and mapped through anti-corruption layers. Import never preserves foreign tenant IDs, authorization, verifier status, or “observed fact” classification without local validation. A dry-run report shows mappings, conflicts, rejections, cost, and policy obligations before an authorized commit. Commit is idempotent and produces source-to-local lineage.

Maintain backward readers or tested migration tools for every still-supported export version. Removal follows published deprecation policy and contract commitments. Public API, event, and DXP compatibility are tested from canonical fixtures.

## Consequences

### Positive

- Reduces lock-in, supports enterprise exit and continuity, and makes domain records independently inspectable.
- Creates a stable integration boundary above model and storage vendors.

### Negative

- Requires long-lived schema governance, migration tooling, streaming export infrastructure, and careful redaction.
- Some provider artifacts cannot legally or safely be exported.

### Neutral

- Exportability does not imply that all derived artifacts retain utility without the original model or licensed source.

## Acceptance evidence

- Golden-package round trips preserve allowed semantics and provenance across supported versions.
- Cross-tenant, zip-bomb, path-traversal, malware, forged-signature, oversized, and replay imports fail safely.
- Consistent-watermark, cancellation, resume, expiry, and customer-key recovery exercises pass.
- Erasure and legal-hold behavior is correct for staged and completed packages.

## Links

- [ADR-005](./ADR-005-make-provenance-and-epistemic-classification-mandatory.md)
- [ADR-012](./ADR-012-adopt-privacy-by-design-and-cryptographic-erasure.md)
- [ADR-014](./ADR-014-publish-contract-first-apis-and-versioned-events.md)
- [Data and projection contracts](../ddd/data-and-projection-contracts.md)
