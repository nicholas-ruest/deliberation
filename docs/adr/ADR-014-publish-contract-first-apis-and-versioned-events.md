# ADR-014: Publish Contract-First APIs and Versioned Events

- **Status**: proposed
- **Date**: 2026-07-23
- **Deciders**:
- **Tags**: api, events, compatibility

## Context

Web, CLI, enterprise automation, connectors, and future extracted services need stable contracts. Ad hoc controllers and event payloads cause breaking changes, leaky domain models, unsafe retries, and vendor lock-in.

## Decision

Define external HTTP APIs in OpenAPI and integration events in JSON Schema/AsyncAPI before implementation. Use resource-oriented APIs, typed problem details, cursor pagination, idempotency keys for mutating requests, optimistic concurrency tokens, correlation IDs, and explicit long-running operation resources.

Events use immutable names, schema versions, tenant/correlation/causation metadata, and additive evolution. Breaking changes require a new version and migration window. Consumer-driven compatibility tests run in CI. Internal domain objects are mapped to contracts and never serialized directly.

## Consequences

### Positive

- Stable integrations, generated clients, testable compatibility, and easier context extraction.
- Idempotency and asynchronous behavior are first-class.

### Negative

- Upfront schema design and deprecation governance slow casual changes.
- Mapping layers add code.

### Neutral

- GraphQL may be added for read composition but cannot bypass application authorization.

## Links

- [ADR-002](./ADR-002-use-a-domain-aligned-modular-monolith-first.md)
- [ADR-004](./ADR-004-use-transactional-outbox-and-durable-workflows.md)
- [ADR-008](./ADR-008-secure-mcp-behind-a-policy-enforcing-gateway.md)
