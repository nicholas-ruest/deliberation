# ADR-019: Use a Tamper-Evident Audit Ledger

- **Status**: proposed
- **Date**: 2026-07-30
- **Deciders**:
- **Tags**: audit, compliance, security, forensics

## Context

Application logs and mutable database rows cannot establish who authorized a consequential action, which policy and inputs were used, or whether history was altered. Enterprise customers require tenant-scoped audit export, evidence preservation, and defensible incident reconstruction without exposing deliberation content to operators.

## Decision

Create an append-only audit ledger separate from diagnostic telemetry. Every consequential command, policy decision, human approval, privileged read, external call, artifact publication, configuration change, export, erasure action, and production promotion emits a structured audit record.

Each record includes tenant, actor or workload identity, action, resource reference, outcome, reason code, correlation and causation IDs, policy/configuration versions, source-state or artifact digest where relevant, UTC time, and the previous record hash for its ledger partition. Sensitive values and customer content are represented by classified references or keyed digests, never copied by default.

Write audit intent in the business transaction when possible and seal records asynchronously into tenant/time-partitioned hash chains. Periodically anchor signed partition roots in immutable, retention-locked storage. Verification detects deletion, insertion, reordering, and mutation. Ledger signing keys live in managed KMS/HSM custody and rotate without invalidating prior chains.

Audit access is a separate permission with purpose, case reference, rate limit, and its own audit entry. Exports are signed, encrypted, filtered by tenant and lawful scope, and include a verification manifest. Legal hold and retention are policy driven. Audit failure for a consequential write fails closed unless a documented emergency mode explicitly permits it; emergency actions are locally journaled, alerted, and reconciled before normal operation resumes.

The ledger is evidence of platform activity, not proof that a claim or model output is true.

## Consequences

### Positive

- Supports non-repudiation, forensic reconstruction, regulated-customer evidence, and trustworthy support access.
- Separates stable compliance evidence from noisy observability data.

### Negative

- Adds storage, key-custody, export, verification, and recovery complexity.
- Hash chaining constrains partitioning and requires explicit late-arrival handling.

### Neutral

- A SIEM may consume ledger events but is not the canonical audit store.

## Acceptance evidence

- Mutation, deletion, insertion, and reorder tests fail verification.
- Key rotation, late sealing, backup restore, legal hold, and signed export exercises pass.
- Tenant-isolation tests prove that audit readers and exporters cannot cross scope.
- A sampled consequential journey is reconstructable solely from ledger references and retained artifacts.

## Links

- [ADR-005](./ADR-005-make-provenance-and-epistemic-classification-mandatory.md)
- [ADR-011](./ADR-011-enforce-tenant-isolation-and-zero-trust-authorization.md)
- [ADR-012](./ADR-012-adopt-privacy-by-design-and-cryptographic-erasure.md)
- [Authorization contract](../ddd/authorization-and-audit.md)
