# ADR-037: Federate the MCP Gateway Through federated-mcp

- **Status**: proposed
- **Date**: 2026-08-09
- **Deciders**:
- **Tags**: integrations, mcp, connectors, federated-mcp

## Context

ADR-008 requires all MCP traffic to pass through a mandatory, policy-enforcing gateway (`ConnectorRegistration`, `src/integrations/domain/entities/`), with pinned endpoint identity, schema-hash pinning, tenant grants, and quarantine. That gateway currently addresses one MCP server at a time; nothing in `src/integrations/` coordinates discovery or health across multiple federated MCP servers as the connector catalog grows.

`github.com/ruvnet/federated-mcp` implements the official MCP specification's transport and lifecycle layer for federating MCP systems across multiple servers. Unlike the other projects in this series, it is TypeScript — not published to the npm registry, but installable as a git dependency (`"federated-mcp": "github:ruvnet/federated-mcp"`), consumable directly in this Node codebase without a sidecar process.

## Decision

Add `federated-mcp` as a git-sourced dependency, pinned to a specific commit SHA (not a branch or tag, matching this repository's existing GitHub Actions pinning convention), used only for its transport/discovery layer — connecting to and enumerating multiple MCP servers. It runs entirely *beneath* the existing `ConnectorRegistration` gateway, never in front of it: discovery through `federated-mcp` still requires the same pinned endpoint identity, schema-hash pinning, capability approval, tenant grant, and egress-allowlist checks ADR-008 already mandates before any tool becomes callable. Discovery through the federation layer still never grants use, exactly as ADR-008 already requires for a single server.

Each federated server is registered as its own `ConnectorRegistration`; `federated-mcp` does not get a blanket trust boundary just because it discovered a server. Credential resolution continues to go through the secrets manager reference pattern already established, never through the federation layer itself.

## Consequences

### Positive

- Lets the connector catalog scale to multiple MCP servers without weakening the single-server security model ADR-008 already established — federation adds reach, not new trust.
- A pinned commit SHA, not a registry release, means this repository controls exactly when the dependency changes, consistent with how third-party GitHub Actions are already pinned.

### Negative

- A git-commit dependency doesn't get npm's audit/advisory tooling; `npm audit` won't flag a known vulnerability in it the way it would a registry package. This repository's own `security:scan`, CodeQL, and manual review become the only automated coverage for this one dependency.
- Federation adds an operational surface (multi-server health, partial-failure handling) that a single-server gateway didn't need to reason about.

### Neutral

- This ADR does not change how many MCP servers are actually connected in production — it only makes multi-server federation possible behind the existing gate, gated the same way a single server already is.

## Links

- [ADR-008](./ADR-008-secure-mcp-behind-a-policy-enforcing-gateway.md)
- [ADR-011](./ADR-011-enforce-tenant-isolation-and-zero-trust-authorization.md)
- [ADR-017](./ADR-017-secure-the-software-and-ai-supply-chain.md)
