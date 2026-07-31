# ADR-020: Treat Deployment, Configuration, and Secrets as Versioned Products

- **Status**: proposed
- **Date**: 2026-07-30
- **Deciders**:
- **Tags**: deployment, configuration, secrets, operations

## Context

Reproducible application binaries are insufficient when an environment can drift through manual infrastructure changes, mutable configuration, untracked prompts, or long-lived credentials. Enterprise deployments also need regional placement, controlled tenant overrides, staged rollout, and a reliable path from development to disaster recovery.

## Decision

Define environments with reviewed infrastructure-as-code and GitOps-style reconciliation. Build one signed, immutable application artifact and promote its digest through isolated development, test, staging, and production environments. Never rebuild for promotion.

Use a typed, schema-versioned configuration service. Every effective value has an owner, scope, default, validation rule, sensitivity class, and rollout policy. Platform defaults, region settings, tenant policy, and runtime emergency overrides form an explicit precedence chain. Effective configuration is snapshotted into workflow and reproducibility manifests. Unknown or invalid keys fail startup or activation.

Feature flags are short-lived release controls with owner, expiry, tenant/risk eligibility, audit trail, and safe default. They may not bypass authorization, consent, audit, retention, budget, or release gates. Prompt templates, rubrics, routing policies, verifier definitions, and safety thresholds are signed versioned artifacts, not ad hoc environment strings.

Secrets reside only in a managed secret store, are delivered through workload identity, are never present in source, images, events, telemetry, or configuration snapshots, and have automated rotation and revocation procedures. Human production access is just-in-time, time bounded, approved, and audited. Break-glass access is separately credentialed and exercised.

Deployments use health checks, schema compatibility checks, canaries, automated rollback, and expand-contract migrations. Production mutation is performed only by an independently authorized release identity and produces a release receipt binding artifact, configuration, migration, approver, and source state.

## Consequences

### Positive

- Makes environments reproducible, reviewable, tenant-aware, and recoverable.
- Prevents configuration and prompt changes from bypassing normal release evidence.

### Negative

- Requires configuration tooling, artifact promotion, rotation automation, and disciplined flag cleanup.
- Emergency operation is slower because privileged changes require receipts.

### Neutral

- The specific cloud, IaC engine, and deployment controller remain replaceable behind these controls.

## Acceptance evidence

- A clean environment can be recreated from versioned inputs and restored backups.
- Drift, invalid configuration, expired flags, secret leakage, and unauthorized promotion tests fail closed.
- Canary rollback and credential rotation exercises complete without tenant data loss.
- Release receipts reproduce the exact effective runtime manifest.

## Links

- [ADR-010](./ADR-010-use-versioned-model-routing-and-reproducibility-manifests.md)
- [ADR-015](./ADR-015-operate-with-slos-open-telemetry-and-disaster-recovery.md)
- [ADR-017](./ADR-017-secure-the-software-and-ai-supply-chain.md)
- [Operational acceptance](../ddd/operational-model.md)
