# Deliberation Platform architecture decisions

These proposed ADRs form one coherent production architecture. “Proposed” means the designated deciders must approve them before implementation; it does not mean their details are optional.

| ADR | Decision |
|---|---|
| [ADR-001](./ADR-001-position-as-a-human-authority-decision-laboratory.md) | Product truth and human authority |
| [ADR-002](./ADR-002-use-a-domain-aligned-modular-monolith-first.md) | Domain-aligned modular monolith |
| [ADR-003](./ADR-003-use-postgresql-as-the-canonical-system-of-record.md) | Canonical persistence |
| [ADR-004](./ADR-004-use-transactional-outbox-and-durable-workflows.md) | Events and workflows |
| [ADR-005](./ADR-005-make-provenance-and-epistemic-classification-mandatory.md) | Provenance and epistemic integrity |
| [ADR-006](./ADR-006-use-budgeted-central-orchestration-and-isolated-workers.md) | Planning orchestration |
| [ADR-007](./ADR-007-isolate-branch-memory-behind-a-port.md) | Copy-on-write branch memory |
| [ADR-008](./ADR-008-secure-mcp-behind-a-policy-enforcing-gateway.md) | MCP integration boundary |
| [ADR-009](./ADR-009-use-multi-objective-evaluation-with-abstention.md) | Evaluation and abstention |
| [ADR-010](./ADR-010-use-versioned-model-routing-and-reproducibility-manifests.md) | Model portability and reproducibility |
| [ADR-011](./ADR-011-enforce-tenant-isolation-and-zero-trust-authorization.md) | Identity and tenant isolation |
| [ADR-012](./ADR-012-adopt-privacy-by-design-and-cryptographic-erasure.md) | Privacy, retention and erasure |
| [ADR-013](./ADR-013-restrict-learning-to-observed-outcomes-and-gated-promotion.md) | Controlled learning |
| [ADR-014](./ADR-014-publish-contract-first-apis-and-versioned-events.md) | API and event contracts |
| [ADR-015](./ADR-015-operate-with-slos-open-telemetry-and-disaster-recovery.md) | Reliability and operations |
| [ADR-016](./ADR-016-reserve-and-meter-compute-before-execution.md) | Commercial cost control |
| [ADR-017](./ADR-017-secure-the-software-and-ai-supply-chain.md) | Supply-chain security |
| [ADR-018](./ADR-018-require-evidence-based-release-quality-gates.md) | Production quality gates |
| [ADR-019](./ADR-019-use-a-tamper-evident-audit-ledger.md) | Tamper-evident audit and forensic evidence |
| [ADR-020](./ADR-020-treat-deployment-configuration-and-secrets-as-versioned-products.md) | Deployment, configuration, flags, and secrets |
| [ADR-021](./ADR-021-build-owned-projections-search-and-caches-from-canonical-events.md) | Owned projections, search, and cache consistency |
| [ADR-022](./ADR-022-use-cell-based-failure-isolation-and-admission-control.md) | Failure isolation, admission, and overload control |
| [ADR-023](./ADR-023-require-risk-tiered-human-oversight-and-safety-cases.md) | Risk-tiered oversight and safety cases |
| [ADR-024](./ADR-024-make-enterprise-lifecycle-and-support-first-class.md) | Enterprise onboarding, administration, support, and exit |
| [ADR-025](./ADR-025-guarantee-versioned-data-portability-and-interoperability.md) | Versioned data portability and interoperability |

## Decision policy

- Accepted ADRs are mandatory constraints until superseded; implementation convenience is not an exception.
- Every ADR must name measurable acceptance evidence. [ADR-018](./ADR-018-require-evidence-based-release-quality-gates.md) and the [DDD readiness standard](../ddd/implementation-readiness.md) aggregate those gates.
- A material change to tenant isolation, epistemic rules, human authority, safety envelope, data residency, audit integrity, or release authority requires a superseding ADR and migration plan.
- Provider and framework selections may change without a new ADR only when the replacement preserves the recorded decision, contracts, and evidence.
