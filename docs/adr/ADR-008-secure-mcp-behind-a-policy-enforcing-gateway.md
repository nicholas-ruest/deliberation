# ADR-008: Secure MCP Behind a Policy-Enforcing Gateway

- **Status**: proposed
- **Date**: 2026-07-23
- **Deciders**:
- **Tags**: mcp, integrations, security

## Context

MCP is a useful tool/resource protocol, but remote servers, schemas, content, and tool results are untrusted. Direct worker access to arbitrary MCP servers creates credential, exfiltration, prompt-injection, SSRF, confused-deputy, and unauthorized-write risks.

## Decision

All MCP traffic passes through a gateway that authenticates connector identity, pins endpoint and schema versions, resolves credentials from a secrets manager, enforces tenant/purpose/capability policy, validates payloads, applies egress rules, rate limits, scans content, records audit metadata, and circuit-breaks/quarantines unhealthy connectors.

Discovery never grants use. Read and write capabilities are classified separately; consequential writes require explicit per-action authorization and human approval obligations. Workers receive short-lived capability tokens, not provider credentials. Tool output is evidence with external-claim provenance, never trusted instructions.

## Consequences

### Positive

- Centralized least privilege, audit, revocation, and prompt-injection containment.
- Connector behavior remains consistent across models and workers.

### Negative

- Adds latency, gateway availability requirements, and connector certification work.
- Some dynamic MCP features are unavailable until reviewed.

### Neutral

- Stdio and Streamable HTTP transports can coexist behind the same policy.

## Links

- [ADR-005](./ADR-005-make-provenance-and-epistemic-classification-mandatory.md)
- [ADR-011](./ADR-011-enforce-tenant-isolation-and-zero-trust-authorization.md)
- [ADR-017](./ADR-017-secure-the-software-and-ai-supply-chain.md)
