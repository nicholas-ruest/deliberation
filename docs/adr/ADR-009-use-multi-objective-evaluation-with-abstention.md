# ADR-009: Use Multi-Objective Evaluation with Abstention

- **Status**: proposed
- **Date**: 2026-07-23
- **Deciders**:
- **Tags**: evaluation, decision-science, safety

## Context

A single “winning branch” hides value conflict and uncertainty. Generic LLM judges exhibit correlated errors and are not reliable external verifiers. Consequential decisions require hard constraints, transparent trade-offs, sensitivity, dissent, and the ability to decline a recommendation.

## Decision

Evaluate options using immutable user-approved preference snapshots. Apply hard constraints before soft scores. Preserve dimension units and rubric versions; compute Pareto-efficient options, dominance, robustness, disagreement, and sensitivity to weights/assumptions. Probabilities require a stated calibration basis.

Verifier precedence is: executable domain simulator/solver, observed historical outcome with causal caveats, deterministic constraint/test, independent expert/user review, calibrated specialist model, then generic LLM judgment. LLM judgment alone cannot mark a consequential claim verified.

Abstain when required evidence is missing, material verifiers conflict, uncertainty exceeds policy bounds, or every option violates hard constraints. Abstention is a valid completed result with actionable unblock conditions.

## Consequences

### Positive

- Recommendations are explainable, preference-sensitive, and honest about uncertainty.
- Avoids false precision and unsafe forced ranking.

### Negative

- Evaluation and UX are substantially more complex than one score.
- Some users will receive no recommendation until evidence improves.

### Neutral

- Domain plugins may add verified scoring dimensions without bypassing common rules.

## Links

- [ADR-001](./ADR-001-position-as-a-human-authority-decision-laboratory.md)
- [ADR-005](./ADR-005-make-provenance-and-epistemic-classification-mandatory.md)
- [Evaluation aggregates](../ddd/aggregate-catalog.md#evaluationrun)
