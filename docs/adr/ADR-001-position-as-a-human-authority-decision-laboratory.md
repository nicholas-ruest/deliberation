# ADR-001: Position as a Human-Authority Decision Laboratory

- **Status**: proposed
- **Date**: 2026-07-23
- **Deciders**:
- **Tags**: product, safety, ai-governance

## Context

Copy-on-write memory makes branch creation cheap, but it does not make generated futures accurate or define human utility. Calling the platform a future simulator or autonomous decision-maker would overstate validity, encourage automation bias, and create avoidable regulatory and product liability.

## Decision

The product is an evidence-grounded **decision laboratory**. It explores alternatives, exposes assumptions, verifies constraints, analyzes trade-offs, and produces a decision brief. The user or an explicitly authorized human body remains the decision authority.

Generated scenarios are labeled hypotheses, scores remain traceable to user-approved criteria, and consequential workflows support abstention and mandatory human review. The system never claims to have “lived” a future, never silently records a generated recommendation as a human decision, and never executes an external consequential action without a separately authorized workflow.

## Consequences

### Positive

- Product claims align with demonstrable capability and responsible-AI controls.
- Human authority, uncertainty, dissent, and reversibility become testable requirements.

### Negative

- Marketing is less sensational and some automation use cases are excluded.
- UX must communicate nuanced uncertainty without overwhelming users.

### Neutral

- Domain-specific automation may be approved later under separate risk analysis and ADRs.

## Links

- [Research basis](../../.plans/deliberation-deep-research.md)
- [ADR-005](./ADR-005-make-provenance-and-epistemic-classification-mandatory.md)
- [ADR-009](./ADR-009-use-multi-objective-evaluation-with-abstention.md)
