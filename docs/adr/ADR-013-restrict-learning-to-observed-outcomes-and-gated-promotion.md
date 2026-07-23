# ADR-013: Restrict Learning to Observed Outcomes and Gated Promotion

- **Status**: proposed
- **Date**: 2026-07-23
- **Deciders**:
- **Tags**: learning, calibration, mlops

## Context

Online self-learning from generated scenarios can create self-confirming errors, preference drift, poisoning, privacy leakage, and unreproducible behavior. SAFLA-like memory patterns are useful only when predictions are distinguished from later observations and changes are evaluated independently.

## Decision

Store predicted and observed outcomes separately with timestamps, provenance, consent, corrections, and cohort eligibility. Generated outcomes never count as observations. Compute calibration and drift only on policy-qualified cohorts.

Learning produces immutable `LearningCandidate` artifacts offline. Promotion requires reproducible derivation, held-out improvement, calibration, safety/privacy/fairness non-regression, independent approval, signed artifacts, canary rollout, monitored thresholds, and automatic rollback. User preference inference remains suggested until confirmed. Production safety policy cannot be learned.

SAFLA or another learning engine may implement ports only after passing these controls; it does not own production truth or promotion.

## Consequences

### Positive

- Learning is measurable, reversible, and resistant to feedback loops.
- Supports genuine longitudinal differentiation through calibrated outcomes.

### Negative

- Improvement is slower and needs enough delayed ground truth.
- Offline pipelines, evaluation sets, approvals, and artifact registry add cost.

### Neutral

- Tenant-local and global candidates have different consent/privacy thresholds.

## Links

- [Learning aggregates](../ddd/aggregate-catalog.md#outcomerecord)
- [ADR-005](./ADR-005-make-provenance-and-epistemic-classification-mandatory.md)
- [ADR-018](./ADR-018-require-evidence-based-release-quality-gates.md)
