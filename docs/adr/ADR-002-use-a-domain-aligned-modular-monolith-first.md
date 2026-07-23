# ADR-002: Use a Domain-Aligned Modular Monolith First

- **Status**: proposed
- **Date**: 2026-07-23
- **Deciders**:
- **Tags**: architecture, ddd, deployment

## Context

The platform needs strong domain isolation but has no measured need for independently deployed microservices or a peer-to-peer neural mesh. Premature distribution would multiply failure modes, operating cost, schema coordination, security boundaries, and debugging effort before product-market evidence exists.

## Decision

Implement the ten bounded contexts in [the context map](../ddd/context-map.md) as enforceable modules in a TypeScript modular monolith, with background workers deployable from the same versioned codebase. Modules own schemas, expose application contracts, and communicate through public APIs/events; direct cross-schema reads and infrastructure exports are forbidden.

Package and architecture tests enforce boundaries. A context may be extracted only when measured scaling, isolation, release-cadence, residency, or ownership pressure exceeds the cost of distribution. Extraction preserves published contracts.

## Consequences

### Positive

- Transactional simplicity and fast development without sacrificing domain boundaries.
- One deployable can still scale API and worker roles independently.

### Negative

- Poor discipline could produce a big ball of mud; automated boundary tests are mandatory.
- Context extraction later requires careful data and workflow migration.

### Neutral

- Logical ownership is independent of physical deployment.

## Links

- [DDD context map](../ddd/context-map.md)
- [ADR-004](./ADR-004-use-transactional-outbox-and-durable-workflows.md)
- [ADR-014](./ADR-014-publish-contract-first-apis-and-versioned-events.md)
