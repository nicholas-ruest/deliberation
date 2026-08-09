# ADR-036: Route Model Requests Through agentic-flow's Cost-Optimal Provider Gateway

- **Status**: proposed
- **Date**: 2026-08-09
- **Deciders**:
- **Tags**: model-gateway, routing, cost, agentic-flow

## Context

`src/platform/model-gateway/model-gateway.ts` already implements the shape ADR-010 requires: provider-neutral `ModelRoute`/`RoutingPolicy` types, a `ModelDependencyEligibility` port, and task/region/risk/cost-aware route selection. What it does not have is a real routing engine — `denyUnqualifiedModelDependencies`, the only implementation in the file, refuses every request (`DEPENDENCY_UNAVAILABLE`) by design, because there is nothing behind the port yet.

`agentic-flow` (`github.com/ruvnet/agentic-flow`, real npm package, `2.1.2`) is a routing runtime that selects a cost-optimal model per query across providers and can deploy the resulting agent as a hosted service. Its scope overlaps almost exactly with what `ModelRoute`/`RoutingPolicy` already model.

## Decision

Add `agentic-flow` as a direct npm dependency, used only as the *routing/selection engine* behind the existing `ModelDependencyEligibility` port and `RoutingPolicy` evaluation in `model-gateway.ts` — not as a replacement for this platform's own contract. `agentic-flow` proposes a route (provider, model, estimated cost); this platform's existing policy evaluation still enforces ADR-010's constraints (allowlisted immutable provider/model identifiers, region, risk tier, data policy) before any candidate route is accepted. A route `agentic-flow` proposes that fails those checks is rejected the same way any other unqualified route is today — the dependency can suggest, never authorize.

Every generated artifact still records routing-policy version, provider/model ID, prompt/template hash, and usage exactly as ADR-010 requires, regardless of which engine chose the route. `agentic-flow`'s own hosted-deployment features are explicitly out of scope for this ADR — only its model-selection logic is adopted, run in-process, not its deployment surface.

## Consequences

### Positive

- Gives the model gateway a real, cost-aware selection engine instead of a permanent deny-all stub.
- Keeps ADR-010's governance (immutable versions, fallback safety, manifest recording) as the final authority, so the dependency's own judgment can't silently widen what's allowed.

### Negative

- `agentic-flow` was designed to be the caller's harness, not a suggestion engine wrapped by someone else's policy layer; using only its routing logic and discarding its deployment/harness features means depending on a moving target whose primary use case this platform deliberately doesn't take.
- Provider contract tests (already required by ADR-010's acceptance criteria) must now also cover `agentic-flow`'s output shape.

### Neutral

- This ADR does not change which model providers are actually qualified for production use — that remains governed by ADR-031's dependency catalog, unaffected by which engine proposes a route.

## Links

- [ADR-010](./ADR-010-use-versioned-model-routing-and-reproducibility-manifests.md)
- [ADR-031](./ADR-031-qualify-and-contain-external-production-dependencies.md)
