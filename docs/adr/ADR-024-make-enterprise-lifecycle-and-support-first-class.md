# ADR-024: Make Enterprise Lifecycle and Support First-Class

- **Status**: proposed
- **Date**: 2026-07-30
- **Deciders**:
- **Tags**: enterprise, support, administration, lifecycle

## Context

An enterprise product is not complete when its core workflow works. Customers need controlled onboarding, federation, policy setup, safe trials, service reporting, support, offboarding, and contractual entitlement changes. Manual database edits and unrestricted support access are neither scalable nor acceptable.

## Decision

Model the customer lifecycle as durable, idempotent workflows owned jointly through published contracts by Identity & Access, Governance, Commercial Operations, and platform operations.

Onboarding verifies organization and contract, allocates tenant/region/cell and encryption references, establishes federation and break-glass ownership, activates plan and quotas, applies a reviewed policy baseline, validates audit/export destinations, and runs a readiness test before activation. Trials use isolated entitlements, explicit expiry, spend ceilings, export rules, and conversion/closure workflows.

Enterprise administration exposes least-privilege roles for identity, policy, billing, audit, connector, data-governance, and support administration. No universal “tenant admin” role is required. Dangerous changes use reauthentication, step-up approval, preview/dry run, and reversible activation where possible.

Support operates through tenant-initiated cases with severity, affected scope, communication target, and time-bound consent. Support identities are separate workload/person identities, just-in-time privileged, purpose bound, field masked by default, and fully audited. Diagnostic bundles are generated server-side from allowlisted metadata and customer-selected artifacts. Support cannot impersonate a user, alter canonical content, or export content outside the case workflow.

Suspension distinguishes security containment, commercial restriction, customer request, and legal order. Each reason has explicit read, export, recovery, billing, retention, and reactivation semantics. Offboarding supports verified export, connector/credential revocation, retention or legal hold, cryptographic erasure, signed completion evidence, and delayed destruction of recovery material per policy.

Service-level reporting is computed from canonical operational measurements and excludes customer content. Contract overrides are versioned entitlements/policies with effective dates and approval, never one-off code branches.

## Consequences

### Positive

- Makes onboarding, support, renewal, suspension, and exit repeatable and auditable.
- Enables enterprise separation of duties without bespoke deployments.

### Negative

- Adds administrative workflows and operational tooling before revenue scale demands them.
- Support is slower when customer consent or approval is required.

### Neutral

- CRM and ticketing systems remain systems of engagement; platform lifecycle state remains canonical internally.

## Acceptance evidence

- Automated onboarding, trial expiry/conversion, suspension/reactivation, support, and offboarding journeys pass.
- Support-access tests prove scope, expiry, masking, audit, and non-impersonation.
- A tenant can recover from partial onboarding and retry without duplicate resources or charges.
- Contract reports reconcile against telemetry and entitlement history.

## Links

- [ADR-011](./ADR-011-enforce-tenant-isolation-and-zero-trust-authorization.md)
- [ADR-012](./ADR-012-adopt-privacy-by-design-and-cryptographic-erasure.md)
- [ADR-016](./ADR-016-reserve-and-meter-compute-before-execution.md)
- [Capability and entitlement model](../ddd/capability-and-entitlement-model.md)
