# ADR-035: Add AgentDB as the Evidence Context's Vector Memory

- **Status**: proposed
- **Date**: 2026-08-09
- **Deciders**:
- **Tags**: evidence, search, vector-memory, agentdb

## Context

`src/evidence/infrastructure/` is currently one comment (`// Internal adapters; never export from the context public API.`). The Evidence context has a domain model (`EvidenceRecord`, ADR-005's provenance/epistemic-classification rules) but no retrieval implementation: nothing lets a deliberation find prior evidence, precedent claims, or related material by similarity rather than by exact ID. ADR-021 already establishes that search/vector indexes are disposable, rebuildable projections, never canonical state — Evidence needs an adapter that respects that boundary, not a new source of truth.

`agentdb` (`github.com/ruvnet/agentdb`, real npm package, currently `3.0.0-alpha.20`) is a single-file, embeddable vector-memory store with HNSW search, hybrid (BM25 + dense) retrieval, and episodic/causal-graph structure purpose-built for exactly this shape of problem: "what evidence have we seen before that's relevant to this claim."

## Decision

Add `agentdb` as a direct npm dependency. Define an `EvidenceSearchPort` (create index entry, query by similarity + filters, remove/tombstone) in `src/evidence/domain/repositories/`, matching the shape of the existing `BranchMemoryPort` (ADR-007): the port is the domain-facing contract, `agentdb` is one replaceable adapter behind it, implemented in `src/evidence/infrastructure/`.

Index entries are derived, disposable data: they carry the same tenant/purpose partitioning and content hash reference ADR-005 already requires, never the canonical `EvidenceRecord` itself. Embeddings are generated only from redacted, sensitivity-cleared content per ADR-021's rule ("secret/forbidden fields are excluded"). Retrieval filters (tenant, purpose, sensitivity, epistemic class) apply before ranking and again before response construction, matching ADR-021's search rule exactly. Erasure (ADR-012) must cover AgentDB's index and any exported artifact, not just PostgreSQL rows.

Because `agentdb` is pre-1.0 (`alpha`) and version-pinned exactly, not range-pinned, per this repository's existing dependency convention.

## Consequences

### Positive

- Gives Evidence a real precedent/similarity search capability where today there is none.
- Stays behind a port, so a alpha-stage dependency can be swapped without touching domain code, consistent with how agenticow was contained (ADR-007).

### Negative

- `agentdb` is pre-1.0; its API and on-disk format may change between minor versions, so upgrades need contract-test coverage before a version bump lands.
- A second embedded vector store (alongside agenticow's ruvector-based branch memory) is a second index format to operate, benchmark, and erase correctly.

### Neutral

- AgentDB's episodic/causal-graph and reinforcement-learning features are not adopted by this ADR — only its vector-memory/HNSW-search surface is in scope. Adopting more of its surface (e.g., as a candidate for ADR-013's learning-engine port) is a separate decision.

## Links

- [ADR-005](./ADR-005-make-provenance-and-epistemic-classification-mandatory.md)
- [ADR-007](./ADR-007-isolate-branch-memory-behind-a-port.md)
- [ADR-012](./ADR-012-adopt-privacy-by-design-and-cryptographic-erasure.md)
- [ADR-021](./ADR-021-build-owned-projections-search-and-caches-from-canonical-events.md)
