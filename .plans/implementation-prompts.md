# Deliberation Platform: Sequential Implementation Prompts

## How to use this plan

Execute these prompts in order. Each prompt is an independently reviewable implementation increment, but later prompts assume the named prerequisites are merged and their contracts are stable. Keep the platform a TypeScript modular monolith with independently runnable API and worker processes. Do not bypass context-owned schemas, public contracts, tenant authorization, provenance, idempotency, or the release evidence required by the referenced decisions.

The governing domain documents are:

- `docs/ddd/README.md` — strategic domain map, shared modeling rules, lifecycle, and architecture tests.
- `docs/ddd/context-map.md` — bounded contexts, integration matrix, and anti-corruption boundaries.
- `docs/ddd/aggregate-catalog.md` — aggregate roots, invariants, commands, and transaction boundaries.
- `docs/ddd/implementation-readiness.md` — definition of done, acceptance journeys, quality gates, test pyramid, and prohibited shortcuts.

Every implementation increment must satisfy the applicable parts of `docs/ddd/implementation-readiness.md`, not defer all quality work to the final prompt.

---

## Prompt 01 — Establish the modular-monolith skeleton and contract governance

**Implements:** `ADR-002-use-a-domain-aligned-modular-monolith-first.md`, `ADR-014-publish-contract-first-apis-and-versioned-events.md`, and `ADR-018-require-evidence-based-release-quality-gates.md`; `docs/ddd/README.md` sections “Strategic domain map,” “Shared modeling rules,” and “Required architecture tests”; all bounded contexts in `docs/ddd/context-map.md`.

**Prerequisites:** None.

**Prompt:**

> Create the foundational TypeScript modular-monolith structure for all ten bounded contexts named in `docs/ddd/context-map.md`: Identity & Access, Deliberation, Preferences, Evidence, Scenario Planning, Evaluation, Governance, Learning, Integrations, and Commercial Operations. Give each context separate domain, application, contract, and infrastructure boundaries, but do not implement business features yet. Define the common command and domain-event envelopes required by `docs/ddd/README.md`, including tenant, principal, aggregate version, correlation, causation, schema version, UTC time supplied through a port, and idempotency metadata. Establish OpenAPI, JSON Schema, and AsyncAPI locations and validation/build generation. Add dependency rules and architecture tests that reject domain-to-infrastructure imports, direct cross-context implementation imports, infrastructure exports from public APIs, cross-schema reads, and direct serialization of domain objects. Add CI jobs for type checking, contract compatibility, architecture tests, and migration checks. Document the exact allowed dependency direction and context ownership.
>
> Acceptance criteria: all ten modules compile in isolation; a deliberately forbidden import fails an architecture test; example v1 command, problem-detail response, long-running operation, and integration event schemas validate; event evolution tests demonstrate additive compatibility; no context exposes a database adapter or arbitrary query builder; the baseline test layout maps to `docs/ddd/implementation-readiness.md`.

**Unlocks:** Every subsequent prompt.

---

## Prompt 02 — Build secure delivery, artifact, and worker-execution foundations

**Implements:** `ADR-017-secure-the-software-and-ai-supply-chain.md` and `ADR-018-require-evidence-based-release-quality-gates.md`; `docs/ddd/implementation-readiness.md` sections “Non-functional quality gates,” “Required test pyramid,” and “Prohibited shortcuts.”

**Prerequisites:** Prompt 01.

**Prompt:**

> Implement the secure development and delivery baseline before executing model or connector workloads. Pin lockfiles and runtime images; add least-privilege CI, SAST, SCA, secret, IaC, license, and container scans; generate an SBOM; sign build provenance and release artifacts; and define revocation and rollback procedures. Create the worker sandbox profile with a read-only base image, no ambient credentials, explicit CPU/memory/time limits, controlled egress, and short-lived capability-token injection points. Establish typed validation boundaries for prompts, retrieved content, model output, connector schemas, and connector results. Add dependency kill-switch interfaces for model providers, connectors, Agenticow, and learning engines. Seed AI-specific red-team fixtures for prompt injection, poisoned retrieval, schema manipulation, and attempted unauthorized side effects.
>
> Acceptance criteria: CI blocks a vulnerable dependency, leaked test secret, unsigned release artifact, or disallowed image; a sandbox test proves ambient credentials and unapproved network destinations are unavailable; malformed model/connector output fails before a side effect; each kill switch can deny new work without corrupting active domain state; evidence from these checks is retained as a release input.

**Unlocks:** Prompts 09–12 and 17; supplies security controls used by every deployed increment.

---

## Prompt 03 — Implement canonical persistence, context-owned schemas, and durable storage ports

**Implements:** `ADR-003-use-postgresql-as-the-canonical-system-of-record.md`, the schema ownership rule in `ADR-002-use-a-domain-aligned-modular-monolith-first.md`, and storage controls from `ADR-012-adopt-privacy-by-design-and-cryptographic-erasure.md`; `docs/ddd/aggregate-catalog.md` section “Common aggregate envelope”; `docs/ddd/README.md` shared modeling rules.

**Prerequisites:** Prompt 01.

**Prompt:**

> Implement PostgreSQL as the canonical system of record with one owned schema per bounded context, row-level tenant defense, optimistic concurrency, UTC timestamps, append-only audit/outbox foundations, and expand-contract migrations. Define aggregate repository ports that save with an expected version and return typed domain errors without leaking infrastructure exceptions. Add an encrypted S3-compatible object-store port for immutable large artifacts and opaque references. Establish tenant-scoped object-key conventions, envelope-encryption hooks, sensitivity/retention metadata, and rebuildable projection conventions. Do not use vector storage or search projections as authoritative state. Add migration, backfill, rollback, backup, point-in-time restore, and repository contract-test infrastructure.
>
> Acceptance criteria: concurrent saves detect version conflicts; tenant RLS tests deny cross-tenant reads/writes even when application filters are omitted; contexts cannot query another context’s schema; immutable artifacts are hash-addressed through opaque references; projection loss can be rebuilt from canonical records/events; expand-contract migration and restore tests run against production-equivalent PostgreSQL.

**Unlocks:** Prompts 04–18.

---

## Prompt 04 — Implement tenant identity and zero-trust subject resolution

**Implements:** `ADR-011-enforce-tenant-isolation-and-zero-trust-authorization.md` and relevant persistence requirements from `ADR-003-use-postgresql-as-the-canonical-system-of-record.md`; `docs/ddd/context-map.md` section “1. Identity & Access”; `docs/ddd/aggregate-catalog.md` sections “Tenant” and “Principal”; the “All contexts → Identity” row in the integration matrix.

**Prerequisites:** Prompts 01 and 03.

**Prompt:**

> Implement the Identity & Access context and its `Tenant` and `Principal` aggregates exactly as specified in `docs/ddd/aggregate-catalog.md`. Add OIDC/SAML federation and SCIM behind anti-corruption ports that map external claims into internal tenant-scoped principals rather than authorization decisions. Implement tenant lifecycle, region lock after activation, identity configuration, membership, service identities, session epochs, session revocation, and break-glass administrator invariants. Publish the versioned events named in `docs/ddd/context-map.md`. Provide a fail-closed subject-resolution contract for all contexts and propagate tenant/principal identity through database transactions, object keys, messages, caches, telemetry labels, vector namespaces, and future connector grants.
>
> Acceptance criteria: aggregate transition/property tests cover every invariant and command; revocation reaches cached subject resolution within the context-map SLO; automated isolation tests cover ID guessing, cache poisoning, event replay, worker-lease theft, search leakage, and export/erasure crossover; every command has authorization and immutable access-audit tests; disabled or suspended identities cannot start new work.

**Unlocks:** Prompts 05–18.

---

## Prompt 05 — Implement governance policy, consent, purpose, and human-authority controls

**Implements:** `ADR-001-position-as-a-human-authority-decision-laboratory.md`, authorization portions of `ADR-011-enforce-tenant-isolation-and-zero-trust-authorization.md`, and lifecycle controls from `ADR-012-adopt-privacy-by-design-and-cryptographic-erasure.md`; `docs/ddd/context-map.md` section “7. Governance”; `docs/ddd/aggregate-catalog.md` sections “PolicySet” and “ConsentRecord.”

**Prerequisites:** Prompts 03 and 04.

**Prompt:**

> Implement the Governance context with `PolicySet` and `ConsentRecord` aggregates. Create deterministic, deny-by-default policy evaluation using RBAC plus tenant, resource, purpose, risk, capability, and decision-effect attributes. Preserve versioned reasons and obligations on every `PolicyDecision`; enforce deny-overrides-allow, platform controls that tenants cannot weaken, one active policy set per scope/time, fixture validation, separation-of-duties approval, and immutable historic versions. Implement purpose-specific consent, affirmative grant evidence, narrowing, irreversible withdrawal per receipt, legal-hold annotation, retention schedules, risk tiers, human-review requirements, and step-up obligations for consequential operations. Encode ADR-001’s human-authority rules: scenarios are hypotheses, abstention and dissent remain visible, AI output cannot record the human decision, and external consequential actions require separately authorized workflows.
>
> Acceptance criteria: policy fixture and property tests prove ordering and deny precedence; author-only activation is rejected; consent withdrawal blocks new matching processing immediately; legal hold prevents physical erasure but not access restriction; every policy decision records its version/reasons/obligations; attempts to silently treat an AI recommendation as the human decision fail closed.

**Unlocks:** Prompts 07–18.

---

## Prompt 06 — Implement contract-first events, transactional outbox, and durable workflow primitives

**Implements:** `ADR-004-use-transactional-outbox-and-durable-workflows.md` and `ADR-014-publish-contract-first-apis-and-versioned-events.md`; `docs/ddd/aggregate-catalog.md` section “Aggregate transaction boundaries”; `docs/ddd/context-map.md` integration matrix.

**Prerequisites:** Prompts 01, 03, 04, and 05.

**Prompt:**

> Implement the shared application infrastructure for transactional outbox publication, at-least-once versioned integration events, consumer inbox/deduplication, and durable multi-step workflows. State changes and outbox rows must commit in one PostgreSQL transaction. Every event must carry tenant, schema version, aggregate version, correlation, causation, actor, and occurred-at metadata. Every consumer must be idempotent. Define a durable workflow abstraction or persisted state machine supporting timers, cancellation, compensation, retry classification with jitter, timeouts, dead letters, operator repair, and long-running-operation resources. Contract-first mappings must prevent domain-object serialization and support event upcasting and consumer-driven compatibility tests.
>
> Acceptance criteria: crash tests at each publish/consume boundary prove no lost committed work; duplicate and reordered events do not duplicate side effects; workflow fixtures prove retry, timeout, cancellation, compensation, dead-letter, and repair behavior; no test assumes exactly-once transport; event/API breaking changes are rejected without an explicit new version and migration window.

**Unlocks:** All cross-context sagas in Prompts 08 and 11–16.

---

## Prompt 07 — Implement deliberation contracts and explicit stakeholder preferences

**Implements:** product constraints from `ADR-001-position-as-a-human-authority-decision-laboratory.md` and hard-constraint/preference rules from `ADR-009-use-multi-objective-evaluation-with-abstention.md`; `docs/ddd/context-map.md` sections “2. Deliberation” and “3. Preferences”; `docs/ddd/aggregate-catalog.md` sections “DeliberationCase” and “PreferenceProfile.”

**Prerequisites:** Prompts 04, 05, and 06.

**Prompt:**

> Implement the Deliberation and Preferences contexts. Build `DeliberationCase` and `PreferenceProfile` with every command, state, invariant, idempotency rule, and event named in `docs/ddd/aggregate-catalog.md` and `docs/ddd/context-map.md`. Preserve revision history; prevent mutation of a frozen run revision; require a valid question, success definition, options or generate-options mandate, risk classification, authority, and deadline before readiness. Model criteria, units, normalized soft weights, vetoes, risk bounds, stakeholder-specific profiles, immutable snapshots, and explicit conflict analysis. Keep inferred preferences in `suggested` state until confirmed, and never average away stakeholder conflict or turn hard constraints into weights.
>
> Acceptance criteria: transition/property tests cover all lifecycle edges and terminal states; only one active planning run exists per revision; conflicting decision-record replays fail while identical replays are no-ops; preference snapshots are immutable; vetoes remain hard constraints; only a human-authorized command can record a decision; public APIs/events match the schemas from Prompt 01.

**Unlocks:** Prompts 11, 13, 15, and 16.

---

## Prompt 08 — Implement commercial entitlements, budget reservation, and content-free metering

**Implements:** `ADR-016-reserve-and-meter-compute-before-execution.md` and budget/fairness requirements from `ADR-006-use-budgeted-central-orchestration-and-isolated-workers.md`; `docs/ddd/context-map.md` section “10. Commercial Operations”; `docs/ddd/aggregate-catalog.md` section “Entitlement” and the “Starting a run uses a saga” transaction boundary.

**Prerequisites:** Prompts 04–06.

**Prompt:**

> Implement the Commercial Operations context and `Entitlement` aggregate. Map billing-provider data through an anti-corruption boundary; never trust webhook ordering or let provider events mutate quotas without reconciliation. Implement plans, feature entitlements, hard quota buckets, trials, overage policy, reservation, idempotent consumption/release, grace, suspension, provider price catalogs, anomaly alerts, and content-free usage ledgers. Define a synchronous reserve contract and asynchronous reconciliation events. Reservations must cover maximum approved tokens, money, tool calls, branches, wall time, and concurrency before a scenario tree starts. Governance denial must override commercial entitlement.
>
> Acceptance criteria: concurrent reservations cannot exceed a hard quota; duplicate consume/release/reconcile calls are idempotent; cancellation and failed-start compensation release unused quota; budget exhaustion is graceful and auditable; tenant/platform concurrency fairness is tested; no deliberation text, prompt, evidence, or generated content appears in billing dimensions, logs, or events.

**Unlocks:** Prompt 11 and cost gates in Prompt 18.

---

## Prompt 09 — Implement provenance-bearing evidence ingestion and immutable claims

**Implements:** `ADR-005-make-provenance-and-epistemic-classification-mandatory.md`, evidence storage requirements from `ADR-003-use-postgresql-as-the-canonical-system-of-record.md`, and classification/retention controls from `ADR-012-adopt-privacy-by-design-and-cryptographic-erasure.md`; `docs/ddd/context-map.md` section “4. Evidence”; `docs/ddd/aggregate-catalog.md` section “EvidenceRecord.”

**Prerequisites:** Prompts 03–06.

**Prompt:**

> Implement the Evidence context and `EvidenceRecord`. Require immutable content hash/reference, capture time, source locator, purpose, sensitivity, retention, epistemic class, derivation chain, freshness, claims, and verifier status for every item and material generated claim. Support exactly the epistemic classes in `docs/ddd/context-map.md`. Store encrypted payloads in the object store, keep only opaque references in aggregates, redact secrets before embedding, and preserve tenant/purpose constraints in retrieval. Implement versioned classification, verification, restriction, staleness, correction/supersession, and erasure request flows. Generated or simulated content must never become `observed-fact`; reclassification and correction must append audit history rather than overwrite.
>
> Acceptance criteria: missing provenance cannot produce `verified`; supersession is acyclic; content hashes and historic versions are immutable; classification can become less restrictive only with governance approval; all material generated claims preserve model/tool/evidence derivation; retrieval cannot cross tenant or purpose; frozen evidence manifests are reproducible and missing material provenance creates a typed abstention input.

**Unlocks:** Prompts 10–16.

---

## Prompt 10 — Implement versioned model routing and reproducibility manifests

**Implements:** `ADR-010-use-versioned-model-routing-and-reproducibility-manifests.md`, sandbox controls from `ADR-017-secure-the-software-and-ai-supply-chain.md`, and provenance requirements from `ADR-005-make-provenance-and-epistemic-classification-mandatory.md`; model-provider anti-corruption boundary in `docs/ddd/context-map.md`; generated-artifact rule in `docs/ddd/README.md`.

**Prerequisites:** Prompts 02, 04, 05, and 09.

**Prompt:**

> Implement provider-neutral ports for generation, embeddings, reranking, and structured evaluation. Build a versioned routing policy that selects allowlisted immutable provider/model identifiers using task, tenant region, risk tier, data policy, latency, quality, and cost. Adapters must redact secrets, validate request/response schemas, obey residency/retention policy, and expose provider-specific features only as typed optional extensions. Every generated artifact must record routing-policy version, provider/model ID, parameters, prompt/template hash, tool/evidence manifest, safety configuration, usage, timestamps, output hash, and seed where supported. Fallbacks may reduce capability but must not weaken governance. Describe replay as evidential reconstruction, not guaranteed byte identity.
>
> Acceptance criteria: provider contract tests use deterministic fixtures; mutable aliases are rejected for frozen runs; policy tests cover region, risk, privacy, cost, and outage routing; malformed or untrusted output cannot cross the adapter boundary; fallback retains all safety/privacy constraints; a run manifest reconstructs exactly which inputs, policy, tools, model, and parameters produced each artifact.

**Unlocks:** Prompts 11, 13, 15, and 18.

---

## Prompt 11 — Implement the policy-enforcing MCP and connector gateway

**Implements:** `ADR-008-secure-mcp-behind-a-policy-enforcing-gateway.md`, `ADR-011-enforce-tenant-isolation-and-zero-trust-authorization.md`, and connector defenses from `ADR-017-secure-the-software-and-ai-supply-chain.md`; `docs/ddd/context-map.md` section “9. Integrations” and its MCP anti-corruption boundary; `docs/ddd/aggregate-catalog.md` section “ConnectorRegistration.”

**Prerequisites:** Prompts 02–06, 09, and 10.

**Prompt:**

> Implement the Integrations context, `ConnectorRegistration`, and a mandatory gateway for all MCP traffic. Support connector registration, pinned endpoint identity, stdio and Streamable HTTP transports, credential references resolved from a secrets manager, schema discovery, schema-hash pinning, capability approval/revocation, tenant grants, purpose/risk policy checks, egress allowlists, rate limits, content scanning, audit, health, circuit breaking, quarantine, and restoration. Discovery must never grant use. Classify read and write separately; consequential writes require explicit per-action authorization and human-review obligations. Give workers only short-lived capability tokens. Convert tool output into `external-claim` evidence with provenance and never treat it as instructions.
>
> Acceptance criteria: credentials never enter aggregates/events/logs; identity or schema drift disables the capability; quarantine rejects new and in-flight results; unapproved SSRF/egress attempts fail; prompt-injected output cannot initiate a second tool call; write calls without all governance obligations fail closed; connector compromise journey tests from `docs/ddd/implementation-readiness.md` pass.

**Unlocks:** Tool-backed scenario work in Prompt 12 and connector-sourced Evidence in Prompt 09.

---

## Prompt 12 — Implement budgeted scenario orchestration and isolated workers

**Implements:** `ADR-006-use-budgeted-central-orchestration-and-isolated-workers.md`, `ADR-004-use-transactional-outbox-and-durable-workflows.md`, `ADR-010-use-versioned-model-routing-and-reproducibility-manifests.md`, and `ADR-016-reserve-and-meter-compute-before-execution.md`; `docs/ddd/context-map.md` section “5. Scenario Planning”; `docs/ddd/aggregate-catalog.md` section “ScenarioTree” and the start-run saga boundary.

**Prerequisites:** Prompts 02–11.

**Prompt:**

> Implement the Scenario Planning context, central durable orchestrator, and horizontally scalable stateless sandboxed workers. Build `ScenarioTree` with frozen deliberation, preference, evidence, policy, routing, and connector manifests; exactly one root; acyclic branch lineage; explicit branch/depth/token/money/time/tool/concurrency budgets; reproducibility metadata; cancellation; and terminal-state enforcement. Implement the start-run saga in this exact order: validate deliberation, authorize policy, reserve quota, freeze inputs, then create/start the tree, with compensation for every partial failure. Workers acquire expiring tenant-bound leases and commit idempotently; cancellation stops new leases and rejects late commits. Start with bounded deliberately diverse branches, label same-model samples correlated, prune dominated/duplicative branches, and expand only by configured uncertainty or information-value policy.
>
> Acceptance criteria: no run starts without authorization, reservation, and immutable inputs; budgets never go negative; duplicate lease completion is logically exactly once; stolen/cross-tenant/expired leases fail; cancellation and budget-exhaustion journeys produce consistent terminal states and release unused quota; crash/retry tests preserve lineage; no generated branch is promoted as fact; no peer-to-peer mesh or unbounded loop is introduced.

**Unlocks:** Prompts 13 and 14.

---

## Prompt 13 — Implement portable copy-on-write branch memory behind a domain port

**Implements:** `ADR-007-isolate-branch-memory-behind-a-port.md`, canonical-storage constraints from `ADR-003-use-postgresql-as-the-canonical-system-of-record.md`, and planning boundaries from `ADR-006-use-budgeted-central-orchestration-and-isolated-workers.md`; `docs/ddd/context-map.md` Agenticow anti-corruption boundary; `docs/ddd/aggregate-catalog.md` section “ScenarioTree.”

**Prerequisites:** Prompts 03, 09, and 12.

**Prompt:**

> Define a `BranchMemoryPort` for create, overlay read/write, tombstone, diff, discard, and approved promotion. Implement a PostgreSQL/object-delta baseline adapter and an Agenticow adapter without exposing either to domain objects. Keep canonical state, provenance, budgets, branch lineage, and domain events in PostgreSQL. Make tenant, purpose, branch, and frozen-input boundaries mandatory on every operation. Promotion must accept only typed independently verified deltas; it must never merge opaque generated memory or treat simulation as observation. Add migration/export tooling and benchmark both adapters under equivalent workloads before enabling Agenticow by policy.
>
> Acceptance criteria: both adapters pass identical isolation, lineage, deletion, tombstone, crash-recovery, tenant-separation, recall, portability, and benchmark contracts; canonical ScenarioTree recovery works after complete vector-store loss; discard and governed erasure remove overlays; cross-branch contamination tests fail closed; Agenticow can be disabled with no domain/API contract change.

**Unlocks:** Prompt 14 and erasure coverage in Prompt 16.

---

## Prompt 14 — Implement verification, multi-objective evaluation, abstention, and briefs

**Implements:** `ADR-001-position-as-a-human-authority-decision-laboratory.md`, `ADR-005-make-provenance-and-epistemic-classification-mandatory.md`, and `ADR-009-use-multi-objective-evaluation-with-abstention.md`; `docs/ddd/context-map.md` section “6. Evaluation”; `docs/ddd/aggregate-catalog.md` sections “EvaluationRun” and “DecisionBrief” plus the brief-publication transaction boundary.

**Prerequisites:** Prompts 05, 07, 09, 10, 12, and 13.

**Prompt:**

> Implement `EvaluationRun` and `DecisionBrief` from frozen scenario, evidence, preference, and policy manifests. Apply hard constraints before soft scores; preserve units and rubric versions; execute verifiers in ADR-009 precedence; and compute criterion results, Pareto-efficient options, dominance, robustness, dissent, verifier disagreement, and sensitivity to weights/assumptions. Require stated calibration basis for probabilities. Generic LLM judgment alone must never verify a consequential claim. Implement typed abstention for missing material evidence, verifier conflict, excessive uncertainty, or universal hard-constraint failure, with actionable unblock conditions. Compose briefs with citations for every material claim, assumptions, limitations, dissent, sensitivity, eligible/Pareto options, and human call to action. Publish immutable briefs through outbox events and attach them to deliberations idempotently/eventually consistently.
>
> Acceptance criteria: candidate permutation does not change ordering; hard failures cannot be masked by weighted utility; verifier-output schemas/provenance are validated; missing citations fail publication closed; abstention completes successfully without selecting a winner and cannot be removed from its brief; published briefs are immutable and never state that the platform made the user’s decision; safe-deliberation and abstention journeys pass.

**Unlocks:** Prompt 15 and the full decision-laboratory lifecycle.

---

## Prompt 15 — Implement observed outcomes and gated, reversible learning

**Implements:** `ADR-013-restrict-learning-to-observed-outcomes-and-gated-promotion.md`, provenance rules from `ADR-005-make-provenance-and-epistemic-classification-mandatory.md`, model manifests from `ADR-010-use-versioned-model-routing-and-reproducibility-manifests.md`, and gates from `ADR-018-require-evidence-based-release-quality-gates.md`; `docs/ddd/context-map.md` section “8. Learning”; `docs/ddd/aggregate-catalog.md` sections “OutcomeRecord” and “LearningCandidate” plus the learning-promotion transaction boundary.

**Prerequisites:** Prompts 05, 07, 09, 10, and 14.

**Prompt:**

> Implement `OutcomeRecord` so predictions are frozen before decisions and observations are later captured with timestamps, provenance, consent/policy qualification, observation definitions, subjective reporter identity, corrections, and cohort eligibility. Generated or simulated outcomes must never count as observations. Implement calibration and drift only on policy-qualified cohorts. Implement immutable offline `LearningCandidate` artifacts with derivation manifests, held-out evaluation, calibration, safety/privacy/fairness non-regression, independent approval, signed artifacts, canary rollout, monitored rollback thresholds, and a signed prior version. Keep production safety policy non-learnable and preference inference merely suggested until user confirmation. Place SAFLA or any learning engine behind replaceable ports.
>
> Acceptance criteria: prediction timestamps precede observations; corrections supersede rather than overwrite; author-only promotion fails; no candidate directly mutates production; generated outcomes and unconsented data are excluded from cohorts; canary threshold breach automatically rolls back and retains forensic evidence; the learning-regression journey passes; rolled-back versions cannot be re-promoted without a new version and approval.

**Unlocks:** Longitudinal calibration while preserving human authority and privacy.

---

## Prompt 16 — Implement governed retention, consent withdrawal, and cryptographic erasure

**Implements:** `ADR-012-adopt-privacy-by-design-and-cryptographic-erasure.md`, storage lineage from `ADR-003-use-postgresql-as-the-canonical-system-of-record.md`, provenance lineage from `ADR-005-make-provenance-and-epistemic-classification-mandatory.md`, and learning restrictions from `ADR-013-restrict-learning-to-observed-outcomes-and-gated-promotion.md`; `docs/ddd/context-map.md` Governance and Evidence sections; `docs/ddd/aggregate-catalog.md` consent-withdrawal/erasure transaction boundary; `docs/ddd/implementation-readiness.md` “Consent withdrawal and erasure” journey.

**Prerequisites:** Prompts 03–15, because erasure coverage must traverse every implemented storage surface.

**Prompt:**

> Implement the governed erasure process manager spanning canonical records, encrypted blobs, projections, vector indexes, branch deltas, caches, exports, learning cohorts, and backups. Start with immediate purpose-bound processing restriction on consent withdrawal. Discover data through explicit lineage, evaluate retention and legal holds, delete immediately where possible, destroy tenant/data encryption keys for cryptographic erasure where appropriate, schedule backup expiry, and record every completion, exception, and inaccessible remnant. Emit a signed completion/exception report without leaking erased content. Enforce tenant region, provider data-use, retention, export, and legal-hold policy throughout. Exclude customer content from cross-customer training by default.
>
> Acceptance criteria: the readiness erasure journey covers every storage category; legal hold blocks physical deletion but access remains denied; retries are idempotent and resumable; partial failures have operator repair paths; erased items disappear from retrieval, scenarios, exports, and learning eligibility; signed evidence identifies completed actions and lawful exceptions; restoration from backup cannot silently resurrect accessible erased content.

**Unlocks:** Privacy production readiness and enterprise lifecycle guarantees.

---

## Prompt 17 — Implement end-to-end observability, SLOs, operations, and disaster recovery

**Implements:** `ADR-015-operate-with-slos-open-telemetry-and-disaster-recovery.md`, workflow observability from `ADR-004-use-transactional-outbox-and-durable-workflows.md`, orchestration metrics from `ADR-006-use-budgeted-central-orchestration-and-isolated-workers.md`, and quality evidence from `ADR-018-require-evidence-based-release-quality-gates.md`; every context SLO and published event in `docs/ddd/context-map.md`; operability requirements in `docs/ddd/implementation-readiness.md`.

**Prerequisites:** Prompts 02–16.

**Prompt:**

> Instrument APIs, authorization, queues, workflows, scenario steps, budgets, model/tool calls, connectors, evaluation, brief publication, learning, and erasure with OpenTelemetry traces, metrics, and structured logs joined by tenant-safe correlation IDs. Exclude customer prompts/evidence/content by default. Define service-tier SLIs/SLOs and error budgets for API availability/latency, subject resolution/revocation, queue age, run completion/cancellation, brief publication, connector success, authorization, and erasure completion. Add actionable paging, runbooks, synthetic probes without customer content, capacity forecasts, tenant fairness, provider health routing, and cost anomaly alerts. Provision multi-AZ stateful services, point-in-time recovery, versioned objects, infrastructure as code, immutable releases, and tested RPO/RTO.
>
> Acceptance criteria: traces follow a safe-deliberation request across all contexts using correlation/causation IDs; telemetry leakage tests detect content and sensitive high-cardinality labels; every stuck workflow has an exercised repair runbook; queue/provider/connector failures produce actionable symptoms; restore and regional-failure exercises meet documented targets before contractual claims; quarterly restore and annual regional-exercise evidence is retained.

**Unlocks:** Prompt 18 and production operations.

---

## Prompt 18 — Integrate acceptance journeys and enforce evidence-based release gates

**Implements:** `ADR-018-require-evidence-based-release-quality-gates.md` together with all `ADR-001` through `ADR-017` decisions; all of `docs/ddd/implementation-readiness.md`; `docs/ddd/README.md` core end-to-end lifecycle and required architecture tests; `docs/ddd/context-map.md` integration matrix; `docs/ddd/aggregate-catalog.md` transaction boundaries.

**Prerequisites:** Prompts 01–17.

**Prompt:**

> Assemble the platform increments without weakening their published contracts or context boundaries. Implement automated end-to-end journeys for safe deliberation, abstention, cancellation/cost control, consent withdrawal/erasure, connector compromise, and learning regression exactly as specified in `docs/ddd/implementation-readiness.md`. Build the required test pyramid: pure domain/property tests; repository/model/MCP/billing/identity contracts; component tests with real ephemeral infrastructure; workflow journeys; adversarial AI and deterministic replay fixtures; performance, soak, chaos, backup/restore, and disaster-recovery tests; production canaries and content-free synthetic probes. Add accessibility validation to WCAG 2.2 AA, including uncertainty communication and chart alternatives. Compare changes against unaided workflow where measurable, one strong-model baseline, and the current released platform. Require statistically and practically meaningful benefit without safety, privacy, fairness, latency, cost, citation, dissent, calibration, or abstention regression. Gate risk-tiered releases on signed artifacts, auditable approval, staged deployment, canaries, and automated rollback.
>
> Acceptance criteria: CI/CD cannot bypass a failed gate silently; all prohibited shortcuts in `docs/ddd/implementation-readiness.md` have explicit automated checks or review controls; schema compatibility and expand-contract migration/rollback pass; tenant-isolation, prompt-injection, poisoned-memory, citation-correctness, calibration, accessibility, performance, cost-ceiling, restore, and security evidence is attached to the release; a failed canary returns to the signed prior version; production readiness is represented by inspectable evidence rather than a manual assertion.

**Unlocks:** A production release candidate. Future extraction of a bounded context, autonomous consequential action, peer-to-peer mesh, or weakened governance requires measured evidence and a new ADR rather than an implementation shortcut.
