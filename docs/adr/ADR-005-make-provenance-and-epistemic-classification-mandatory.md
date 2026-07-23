# ADR-005: Make Provenance and Epistemic Classification Mandatory

- **Status**: proposed
- **Date**: 2026-07-23
- **Deciders**:
- **Tags**: provenance, evidence, safety

## Context

The largest epistemic risk is treating user assertions, external claims, model inferences, simulated results, and observed facts as interchangeable “memory.” Retrieval and model generation can launder low-quality content into authoritative-sounding recommendations.

## Decision

Every evidence item and material generated claim carries immutable provenance, content hash, capture time, purpose, sensitivity, retention, epistemic class, source/derivation chain, and verifier status. Supported classes are defined in the Evidence context. Reclassification is an auditable transition with stricter rules; generated or simulated content can never become an observed fact.

Every run freezes an input manifest. Every brief claim resolves to evidence or a verification finding. Missing provenance causes evaluation abstention where the claim is material. Corrections supersede instead of overwrite.

## Consequences

### Positive

- Auditable citations, safer retrieval, reproducibility, and correction lineage.
- Enables evidence-quality scoring without pretending all inputs are equal.

### Negative

- Higher storage, ingestion, UI, and integration complexity.
- Some sources cannot meet required provenance and will be excluded from material claims.

### Neutral

- Trust scores guide review; they do not convert claims into truth.

## Links

- [Evidence context](../ddd/context-map.md#4-evidence)
- [ADR-009](./ADR-009-use-multi-objective-evaluation-with-abstention.md)
- [ADR-013](./ADR-013-restrict-learning-to-observed-outcomes-and-gated-promotion.md)
