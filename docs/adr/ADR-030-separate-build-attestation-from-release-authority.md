# ADR-030: Separate Build Attestation from Release Authority

- **Status**: proposed
- **Date**: 2026-07-31
- **Deciders**:
- **Tags**: cicd, signing, provenance, gitops, canary, rollback

## Context

Local CI can build and test, but a source receipt or successful workflow is not authorization to deploy. Production requires immutable artifacts, trusted identities, independent approval, staged rollout, canary evaluation, and verified rollback without a developer holding standing production credentials.

## Decision

Use two separate authorities:

1. A hermetic build pipeline creates immutable images, SBOMs, test/evaluation results, and provenance attestations using ephemeral OIDC workload identity.
2. A protected release controller independently verifies the signed evidence bundle, policy version, approver identities/roles, environment constraints, candidate digest, and signed known-good rollback digest before reconciling deployment.

Only digest-addressed, signature-verified artifacts from the approved registry may run. The release controller uses environment-scoped workload identity and compare-and-swap deployment fencing. Developers, CI jobs, and model agents cannot directly mutate production.

Promotion proceeds through development, integration, staging, limited canary, cell expansion, and general availability. Each transition is separately authorized and observes system, security, cost, privacy, and domain/AI quality signals. A stop condition freezes expansion; a breach rolls back to the verified prior digest and records whether rollback restored health. Rollback failure pages incident command and blocks further automation.

Emergency changes use the same artifact and audit chain with narrower expedited approvals, never an unsigned bypass. Branch protection and protected environments are externally configured and continuously audited.

## Consequences

- CI compromise alone cannot promote an artifact.
- Release speed is bounded by evidence and canary windows for the applicable risk tier.
- Signing, identity, policy, and deployment-controller availability become critical control-plane dependencies.

## Rejected alternatives

- **Deploy on merge**: conflates code integration with release authority.
- **Shared signing keys in repository secrets**: permits identity forgery and weak attribution.
- **Mutable tags and manual `kubectl`**: break artifact identity and auditability.

## Acceptance evidence

- SLSA-style provenance, SBOM, image, configuration, schema, migration, and evaluation digests verify as one release bundle.
- Forged, expired, revoked, replayed, cross-environment, or insufficient-role approvals fail.
- A failed canary automatically restores the signed prior artifact and verifies health.
- Controller compromise and CI compromise tabletop/adversarial tests preserve separation of authority.
- Branch/environment protection drift is detected and blocks promotion.

## Links

- [ADR-017](./ADR-017-secure-the-software-and-ai-supply-chain.md)
- [ADR-018](./ADR-018-require-evidence-based-release-quality-gates.md)
- [ADR-020](./ADR-020-treat-deployment-configuration-and-secrets-as-versioned-products.md)
