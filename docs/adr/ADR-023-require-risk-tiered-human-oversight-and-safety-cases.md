# ADR-023: Require Risk-Tiered Human Oversight and Safety Cases

- **Status**: proposed
- **Date**: 2026-07-30
- **Deciders**:
- **Tags**: ai-governance, safety, human-oversight, model-risk

## Context

A generic disclaimer or approval button does not make consequential AI assistance safe. Different decision domains require different evidence, verifier, disclosure, review, and escalation controls. Commercial deployment needs a repeatable way to decide which uses are allowed and to prove that mitigations remain effective.

## Decision

Classify every deliberation use case into a versioned risk tier before planning. Classification uses decision domain, affected parties, reversibility, financial/physical/legal impact, vulnerability, automation level, data sensitivity, uncertainty, and jurisdictional obligations. Unknown or disputed classification selects the stricter tier.

Each tier binds an approved safety case containing intended use, prohibited use, threat and hazard analysis, required evidence classes, verifier plan, model/tool allowlist, quality thresholds, human roles, disclosure language, monitoring, incident triggers, and residual-risk acceptance. Safety cases are versioned policy artifacts with owners, expiry/review dates, test fixtures, and separation-of-duties approval.

Human review is a typed domain action, not a UI event. Reviewers receive the decision contract, material evidence and provenance, uncertainty, dissent, failed or skipped checks, model/tool manifest, and conflicts of interest. Approval records scope, rationale, conditions, policy version, and reviewer competence/role. The author, candidate promoter, or system being reviewed cannot be the sole approver where separation of duties applies.

Prohibited domains and actions fail closed. High-risk briefs require designated review before publication and cannot trigger external action. The platform always preserves meaningful human choice, supports correction and contestability, and records the actual human decision separately from its recommendation.

Production monitoring links safety-case assumptions to leading and outcome indicators. Threshold breach freezes affected publication or routing, starts incident handling, and requires revalidation before re-enable. Material model, prompt, verifier, policy, data, or use-case change invalidates relevant evidence.

## Consequences

### Positive

- Makes responsible use testable and tailored to actual consequence rather than marketing language.
- Gives enterprise risk, legal, and assurance teams an auditable approval object.

### Negative

- Limits market scope and slows onboarding for novel or high-risk domains.
- Requires qualified reviewers, maintained evaluation sets, and ongoing safety evidence.

### Neutral

- Passing a safety case does not transfer decision accountability from the authorized human or organization.

## Acceptance evidence

- Risk-classification fixtures cover ambiguous, adversarial, and prohibited cases.
- Publication cannot bypass required review, disclosure, competence, or separation-of-duties rules.
- Safety-threshold breach freezes the exact affected scope and rollback/revalidation exercises pass.
- Every supported high-risk capability has an approved, current safety case and evidence manifest.

## Links

- [ADR-001](./ADR-001-position-as-a-human-authority-decision-laboratory.md)
- [ADR-009](./ADR-009-use-multi-objective-evaluation-with-abstention.md)
- [ADR-013](./ADR-013-restrict-learning-to-observed-outcomes-and-gated-promotion.md)
- [Authorization and audit](../ddd/authorization-and-audit.md)
