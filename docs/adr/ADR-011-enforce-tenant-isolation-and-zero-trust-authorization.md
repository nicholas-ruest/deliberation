# ADR-011: Enforce Tenant Isolation and Zero-Trust Authorization

- **Status**: proposed
- **Date**: 2026-07-23
- **Deciders**:
- **Tags**: identity, tenancy, authorization

## Context

Deliberations contain unusually sensitive organizational and personal data. A single cross-tenant leak is existential. Authentication, UI hiding, or application filters alone do not provide sufficient defense.

## Decision

Federate authentication through OIDC/SAML and enterprise lifecycle through SCIM. Resolve all actors to internal tenant-scoped principals. Apply centralized policy decisions using RBAC plus resource/purpose/risk attributes, with deny-by-default and explicit service identities.

Propagate tenant identity through database transactions, object keys, queue messages, vector namespaces, caches, logs, metrics, and connector grants. Apply PostgreSQL row-level security as defense in depth. Use short-lived workload identity, session revocation epochs, step-up authentication for sensitive operations, separation of duties for policy/learning promotion, and immutable access audit.

Automated tenant-isolation tests attempt ID guessing, cache poisoning, event replay, worker lease theft, search leakage, and export/erasure crossover.

## Consequences

### Positive

- Layered containment suitable for enterprise customers and regulated data.
- Uniform authorization across APIs, workers, connectors, and background workflows.

### Negative

- More complex local development, support access, and policy debugging.
- Authorization service and revocation distribution require high availability.

### Neutral

- Dedicated deployments may add stronger physical isolation without changing domain rules.

## Links

- [ADR-008](./ADR-008-secure-mcp-behind-a-policy-enforcing-gateway.md)
- [ADR-012](./ADR-012-adopt-privacy-by-design-and-cryptographic-erasure.md)
- [ADR-017](./ADR-017-secure-the-software-and-ai-supply-chain.md)
