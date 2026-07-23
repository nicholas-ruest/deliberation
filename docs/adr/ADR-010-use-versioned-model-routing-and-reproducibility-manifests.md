# ADR-010: Use Versioned Model Routing and Reproducibility Manifests

- **Status**: proposed
- **Date**: 2026-07-23
- **Deciders**:
- **Tags**: llm, portability, reproducibility

## Context

Model availability, behavior, pricing, retention terms, regional support, and safety characteristics change. Provider aliases are mutable and nondeterministic generation cannot be perfectly replayed. A direct provider dependency weakens commercial resilience and auditability.

## Decision

Use provider-neutral model ports for generation, embeddings, reranking, and structured evaluation. A versioned routing policy selects an allowlisted immutable model identifier by task, tenant region, risk tier, data policy, latency, quality, and cost. Provider request/response adapters enforce schemas and redact secrets.

Every generated artifact records routing-policy version, provider/model identifier, parameters, prompt/template hash, tool/evidence manifest, safety configuration, usage, timestamps, and output hash. Where providers permit, deterministic seeds are recorded, but replay is described as evidential reconstruction rather than guaranteed byte identity. Fallbacks may reduce capability but never weaken governance.

## Consequences

### Positive

- Provider portability, controlled rollout, cost routing, and forensic reconstruction.
- Supports heterogeneous-model diversity without accidental policy drift.

### Negative

- Lowest-common-denominator abstractions and extensive provider contract testing.
- Stored manifests increase data volume and require careful retention.

### Neutral

- Provider-specific capabilities may be exposed as optional typed extensions.

## Links

- [ADR-006](./ADR-006-use-budgeted-central-orchestration-and-isolated-workers.md)
- [ADR-013](./ADR-013-restrict-learning-to-observed-outcomes-and-gated-promotion.md)
- [ADR-018](./ADR-018-require-evidence-based-release-quality-gates.md)
