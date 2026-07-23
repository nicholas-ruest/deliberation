# Aggregate contracts

## Common aggregate envelope

Every aggregate has `id`, `tenantId`, `version`, `createdAt`, `updatedAt`, and uncommitted domain events. Repository saves require expected version. Commands are idempotent at the application boundary. Aggregate methods return domain results or typed errors; they do not throw infrastructure exceptions.

## Tenant

**Root:** `Tenant`
**Owns:** legal/display name, lifecycle, region, identity configuration, encryption-key reference.
**Invariants:** one data-residency region after activation; suspension blocks new work but preserves lawful read/export; deletion requires governance order; identity configuration must retain at least one break-glass administrator.
**Commands:** create, configure identity, activate, suspend, initiate governed deletion.
**Concurrency hotspot:** low.
**Repository queries:** by ID and verified domain only.

## Principal

**Root:** `Principal`
**Owns:** external subject mappings, memberships, status, session epoch.
**Invariants:** unique `(tenant, provider, subject)` mapping; last active owner cannot remove self; disabled principals cannot receive roles; security-sensitive membership change increments session epoch.
**Commands:** provision, grant/revoke membership, disable, revoke sessions.
**PII:** profile attributes live in a separately encrypted projection.

## DeliberationCase

**Root:** `DeliberationCase`
**Owns:** title, decision question, options, constraints, stakeholders, deadline, risk classification reference, lifecycle, brief references, recorded human decision.
**Invariants:** at least two actionable options or an explicit “generate options” mandate; question and success definition required before `scoped`; frozen run revision cannot mutate; one active planning run per revision; only eligible published briefs may be attached; AI output never records the human decision; terminal cases reject mutation.
**Commands:** draft, define contract, add/remove option, scope, mark ready, request planning, attach brief, record human decision, close, cancel, revise.
**Events:** created, scoped, ready, planning-requested, decision-recorded, closed, cancelled, revision-created.
**Idempotency:** recording the same decision is a no-op; a conflicting replay fails.

## PreferenceProfile

**Root:** `PreferenceProfile`
**Owns:** owner/stakeholder scope, criteria, normalized weights, veto constraints, risk bounds, provenance of inferred suggestions, immutable snapshots.
**Invariants:** unique criterion keys; weights finite and non-negative; active soft weights sum to one after normalization; hard constraints have no compensating weight; inferred criteria remain `suggested` until confirmed; snapshots are immutable.
**Commands:** add/retire criterion, set weight, add/remove veto, confirm/reject inference, publish snapshot.
**Evaluation:** conflicting stakeholder profiles remain separate inputs and generate a conflict analysis.

## EvidenceRecord

**Root:** `EvidenceRecord`
**Owns:** content hash/reference, source locator, capture time, epistemic class, claims, provenance chain, freshness, sensitivity, purpose and retention labels, supersession.
**Invariants:** content hash immutable; `verified` requires a qualifying verifier and source; model output cannot be reclassified as observed fact; supersession is acyclic; tenant/purpose labels can only become more restrictive without governance approval; secrets are redacted before embeddings.
**Commands:** ingest, classify, extract claim, verify, mark stale, supersede, restrict, request erasure.
**No physical blob in aggregate:** encrypted blob storage is referenced by opaque ID.

## ScenarioTree

**Root:** `ScenarioTree`
**Entities:** `ScenarioBranch`, `PlanningStep`, `WorkerLease`.
**Owns:** frozen input manifest, expansion policy, root, lineage, budgets, branch states, reproducibility data, cancellation.
**Invariants:** exactly one root; lineage is acyclic; depth/branch/token/cost/time budgets never go negative; branch input snapshot is immutable; every step has model/tool provenance; a branch cannot be promoted as fact; terminal trees reject expansion; lease completion is exactly-once logically through idempotent commit.
**Commands:** start, allocate branch, lease step, commit step, prune, cancel, complete, exhaust budget.
**Physical partitioning:** branch payloads may be segmented; the coordinator serializes budget and lineage decisions.

## EvaluationRun

**Root:** `EvaluationRun`
**Entities:** `VerificationFinding`, `CriterionScore`, `Dissent`, `SensitivityResult`.
**Owns:** frozen scenario/evidence/preference/policy manifests, verifier plan, results, scorecards, Pareto analysis, confidence and abstention.
**Invariants:** input manifests immutable; deterministic verifier results outrank model judgments for the same claim; hard-constraint failure marks option ineligible; score dimensions retain units and rubric version; missing required evidence forces abstention; ordering is stable under candidate permutation tests before publication.
**Commands:** plan verification, record finding, score option, record dissent, compute Pareto frontier, run sensitivity, abstain, complete.
**Security:** verifier outputs are untrusted until schema and provenance validation.

## DecisionBrief

**Root:** `DecisionBrief`
**Owns:** immutable rendered-content manifest, eligible/Pareto options, assumptions, evidence citations, dissent, sensitivity, limitations, call to action, publication/supersession.
**Invariants:** draft is mutable only through regeneration; published brief is immutable; every material claim cites an evidence/finding ID; probabilities identify calibration basis; abstention language cannot be removed; a brief never states that the platform made the user's decision.
**Commands:** compose from completed evaluation, validate, publish, supersede, revoke access.
**Retention:** brief metadata may outlive erased content only when anonymized and policy permits.

## PolicySet

**Root:** `PolicySet`
**Owns:** ordered rules, risk tiers, purposes, decision effects, tool policies, retention schedules, human-review requirements, activation interval.
**Invariants:** only one active set per tenant/scope/time; deny overrides allow; activation requires test suite and separation-of-duties approval; historic versions immutable; platform mandatory controls cannot be weakened by tenant rules.
**Commands:** draft, add rule, validate fixtures, approve, activate, retire.
**Output:** deterministic `PolicyDecision` with reasons and obligations.

## ConsentRecord

**Root:** `ConsentRecord`
**Owns:** subject, controller/tenant, purposes, data classes, grant evidence, effective interval, withdrawal and downstream obligations.
**Invariants:** granular purpose and affirmative evidence required where consent is the basis; withdrawal is irreversible for that receipt; new consent creates a new receipt; withdrawal prevents new processing immediately and triggers downstream restriction/erasure according to policy.
**Commands:** grant, narrow, withdraw, apply legal hold annotation.

## OutcomeRecord

**Root:** `OutcomeRecord`
**Owns:** deliberation/decision references, predictions made before decision, observation definitions, observation values, capture provenance, correction history, cohort eligibility.
**Invariants:** prediction timestamp precedes recorded outcome; generated/simulated results cannot be observations; corrections supersede rather than overwrite; subjective outcomes identify reporter; cohort inclusion requires consent/policy and minimum data quality.
**Commands:** open tracking, record observation, correct, finalize, exclude from learning.

## LearningCandidate

**Root:** `LearningCandidate`
**Owns:** candidate type, derivation data manifest, training/config provenance, evaluation suite/results, approvals, rollout and rollback state.
**States:** `draft -> evaluated -> approved -> canary -> promoted`; rejection/rollback are terminal for a version.
**Invariants:** no direct production mutation; held-out improvement required; safety/privacy/fairness non-regression required; author cannot be sole approver; canary has automatic rollback thresholds; every deployed artifact is reproducible and signed.
**Commands:** propose, attach evaluations, approve/reject, start canary, promote, rollback.

## ConnectorRegistration

**Root:** `ConnectorRegistration`
**Owns:** type, endpoint identity, transport, credential reference, discovered schema hashes, approved capabilities, tenant scopes, egress policy, health/quarantine.
**Invariants:** no secret material stored; endpoint identity pinned; discovery does not grant use; capability approval binds schema hash and read/write class; schema drift disables capability; quarantine blocks calls; writes require governance obligation satisfaction.
**Commands:** register, discover, approve/revoke capability, rotate credential reference, record health, quarantine, restore.

## Entitlement

**Root:** `Entitlement`
**Owns:** tenant plan/contract, enabled features, quota buckets, active reservations, consumption ledger references, grace and suspension status.
**Invariants:** reservation plus consumed quantity cannot exceed hard quota unless explicit overage is allowed; reservation/consume/release idempotent; governance denial overrides entitlement; provider webhook cannot directly mutate quota without reconciliation; content never appears in billing dimensions.
**Commands:** change plan, reserve, consume, release, reconcile, enter/leave grace, suspend commercial access.

## Aggregate transaction boundaries

- Starting a run uses a saga: validate deliberation -> authorize policy -> reserve quota -> freeze input snapshots -> create scenario tree. Compensation releases quota and abandons partial snapshots.
- Publishing a brief uses an outbox event; attaching it to a case is eventually consistent and idempotent.
- Consent withdrawal/erasure uses a process manager spanning evidence, projections, vector indexes, blobs, caches, learning cohorts, and backups.
- Learning promotion uses a deployment workflow; it never shares a database transaction with evaluation.
