# ADR-046: Verify federated-mcp's Contract Against a Live Instance

- **Status**: proposed
- **Date**: 2026-08-09
- **Deciders**:
- **Tags**: integrations, mcp, federated-mcp

## Context

ADR-037's `HttpFederatedMcpDiscovery` adapter targets a documented, explicitly-labeled "ASSUMED,
UNVERIFIED HTTP CONTRACT" (`src/integrations/infrastructure/federated-mcp-discovery.ts`'s own
header comment): `federated-mcp`'s committed HTTP server answers only `GET /` with a plain-text
banner, and its actual documented surface is an in-process `FederationProxy` API
(`registerServer`, `removeServer`, `getConnectedServers`), not the `GET /federation/servers` /
`GET /federation/servers/{id}/tools` shape the adapter assumes. The tests for this adapter
(`tests/integrations/federated-mcp-discovery.test.ts`) all run against a fake HTTP transport that
implements the assumed contract — proving the adapter's own logic is correct, not that the
assumed contract matches reality.

This is a materially different situation from ADR-042/043/044's dependencies: it is not blocked on
a security finding or a missing artifact, it is blocked on nobody having run the real thing yet.

## Decision

1. **Stand up a real `federated-mcp` instance** from its own `Dockerfile`/`start.sh`, in an
   isolated environment (a throwaway container, not this repository's own infrastructure), and
   inspect its actual behavior: does `GET /` really only return the banner, or does the
   in-process `FederationProxy` API expose an HTTP surface once servers are actually registered
   through it that the committed `docs/api.md` doesn't fully capture? Read the source, not just
   the docs, since the adapter's own comment already found the docs incomplete once.
2. **Replace the assumed contract with a verified one.** If a real read-only discovery HTTP surface
   exists (even an undocumented one), update `HttpFederatedMcpDiscovery`'s two path constants and
   two zod schemas to match it — the adapter's own comment already states "nothing outside this
   file depends on the wire format," so this is a contained, low-risk change once the real
   contract is known.
3. **If no such HTTP surface exists at all** — i.e., federation is genuinely only available via
   the in-process `FederationProxy` API, not over HTTP — this ADR's fallback is to re-scope
   ADR-037: either embed `federated-mcp` as an in-process dependency behind
   `FederatedMcpDiscoveryPort` (calling `FederationProxy` directly rather than over HTTP, which
   changes the integration shape from "external service" to "library"), or formally mark
   federation discovery as not viable against the current `federated-mcp` release and keep
   `registerDiscoveredFederation` usable only with an operator-supplied, hand-maintained server
   list (the `provisioningFor` callback already required by ADR-037 already supports this without
   discovery at all).
4. **Either outcome gets a real integration/contract test**, run against the actual
   `federated-mcp` container (gated the same way `TEST_DATABASE_URL`-dependent tests already are
   in this repository — skipped without the container, run for real in CI once available),
   replacing or supplementing the fake-transport tests, not just leaving them as the only
   evidence.

## Consequences

### Positive

- Closes the one dependency in the ADR-035–040 series that is blocked purely on verification
  effort, not on an external constraint (CVE, missing artifact, missing evaluation) — this is the
  cheapest of the six to actually resolve.
- Whichever outcome (HTTP contract confirmed, or re-scoped to in-process/operator-supplied),
  the result is a real, tested integration instead of a documented assumption.

### Negative

- Standing up and inspecting a real `federated-mcp` instance is manual investigative work with an
  uncertain outcome — this ADR cannot guarantee which of the two paths in decision item 3 applies
  until someone does it.
- If the in-process-only outcome holds, `ConnectorGateway`'s existing HTTP/stdio transport
  assumptions (`ConnectorTransport`, ADR-008) may need to grow a third case, a larger change than
  this ADR's scope.

### Neutral

- This ADR does not change ADR-037's core security property: discovery never grants use, and
  every federated server still needs its own `ConnectorRegistration` and human approval,
  regardless of which transport path discovery itself ends up using.

## Links

- [ADR-008](./ADR-008-secure-mcp-behind-a-policy-enforcing-gateway.md)
- [ADR-037](./ADR-037-federate-the-mcp-gateway-through-federated-mcp.md)
