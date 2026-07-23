# ADR-018: Require Evidence-Based Release Quality Gates

- **Status**: proposed
- **Date**: 2026-07-23
- **Deciders**:
- **Tags**: testing, quality, release

## Context

Passing unit tests does not establish that an AI decision-support platform is safe, calibrated, tenant-isolated, recoverable, accessible, or commercially operable. Model/provider changes can regress quality without changing application code.

## Decision

Release only when the [implementation readiness standard](../ddd/implementation-readiness.md) passes. Required gates include domain/property tests, contract/component/journey tests, tenant isolation, authorization, prompt injection and poisoned-memory tests, frozen AI evaluation sets, calibration/citation/dissent/abstention metrics, performance/soak/chaos tests, accessibility, backup/restore, migration rollback, cost ceilings, and security scans.

Maintain model and architecture baselines: unaided workflow where measurable, one strong model, and the current released platform. Changes must show statistically and practically meaningful benefit without safety, privacy, fairness, latency, or cost regression. Risk-tiered releases use signed artifacts, staged deployment, canaries, automated rollback, and auditable approval.

## Consequences

### Positive

- “Production ready” becomes measurable evidence rather than an aspiration.
- Detects regressions from code, data, prompt, model, connector, or policy changes.

### Negative

- Evaluation infrastructure and representative datasets are expensive.
- Releases slow when evidence is ambiguous; some improvements remain experiments.

### Neutral

- Thresholds evolve through approved policy, but a gate cannot be silently bypassed.

## Links

- [DDD readiness standard](../ddd/implementation-readiness.md)
- [ADR-010](./ADR-010-use-versioned-model-routing-and-reproducibility-manifests.md)
- [ADR-013](./ADR-013-restrict-learning-to-observed-outcomes-and-gated-promotion.md)
- [ADR-015](./ADR-015-operate-with-slos-open-telemetry-and-disaster-recovery.md)
