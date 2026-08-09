# ADR-038: Front Vector Reads With RuLake as a Qualified External Dependency

- **Status**: proposed
- **Date**: 2026-08-09
- **Deciders**:
- **Tags**: performance, vector-memory, integrations, rulake

## Context

ADR-035 adds AgentDB behind an `EvidenceSearchPort`; ADR-007 already runs agenticow behind a `BranchMemoryPort`. Both are vector-backed reads that scale with tenant activity. Neither this repository nor either ADR does anything about query-time caching across repeated, similar reads — every query re-executes the full HNSW search.

`github.com/ruvnet/RuLake` is a Rust "cache-coherent vector execution fabric" built for exactly this: it sits in front of a vector store or lakehouse and accelerates repeated/overlapping queries. It is not published to any package registry (no npm, no crates.io entry found) and has no WASM or Node binding — it is a standalone Rust service.

## Decision

Qualify RuLake as an external production dependency through the existing Integrations machinery (`ProductionDependency`, `DependencyQualification`, `src/integrations/domain/entities/production-dependency.ts`) rather than a language dependency: it runs as a separate process the platform calls over a narrow, versioned contract (query in, ranked results with source IDs out), the same shape ADR-021 already requires of any search layer. It never becomes a second source of truth — RuLake's cache is disposable and rebuildable from AgentDB/agenticow at any time, exactly as ADR-021 requires of every projection and cache.

Qualification follows ADR-031 in full: an immutable pinned RuLake version, an owner, a fixture-validated qualification pass, a drift fingerprint, an expiry, an exit plan, and a kill switch (extending the dependency kill-switch interfaces Prompt 02 already established for model providers, connectors, agenticow, and learning engines) before any tenant traffic is allowed to depend on it. Cache keys carry tenant, purpose, and source-version exactly as ADR-021's caching rule requires; a cache-invalidation failure must fail open to the underlying vector store, never serve stale results silently.

Adopt this only where a measured cache-miss cost actually justifies the added operational surface — mirroring the same "enabled only where its measured benefit exceeds operational cost" discipline ADR-007 already applies to agenticow. This ADR authorizes the qualification path; it does not itself claim the benefit has been measured yet.

## Consequences

### Positive

- Gives repeated evidence and branch-memory queries a real acceleration path without inventing a new caching layer from scratch.
- The qualification/kill-switch pattern is already built (ADR-031) — this is reuse, not new machinery.

### Negative

- A Rust sidecar with no registry presence means this repository's supply-chain tooling (npm audit, Dependabot, CodeQL) covers none of it; qualification review and the drift fingerprint become the only automated defense.
- Adds a network hop and a partial-failure mode (cache service down) to every read path that adopts it.

### Neutral

- No context is required to use RuLake; it is an optional acceleration layer any context with a vector read (Evidence, Scenario Planning) may qualify independently.

## Links

- [ADR-007](./ADR-007-isolate-branch-memory-behind-a-port.md)
- [ADR-021](./ADR-021-build-owned-projections-search-and-caches-from-canonical-events.md)
- [ADR-031](./ADR-031-qualify-and-contain-external-production-dependencies.md)
- [ADR-035](./ADR-035-add-agentdb-as-the-evidence-contexts-vector-memory.md)
