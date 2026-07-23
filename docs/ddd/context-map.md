# Bounded context map

## 1. Identity & Access

**Ubiquitous language:** tenant, principal, membership, role, service identity, session, organization.

**Responsibilities:** workforce/customer identity federation, tenant isolation, role and attribute assignments, service-to-service identities, session revocation, SCIM lifecycle, and authorization subject resolution.

**Not responsible for:** decision-specific approval policy or consent. Governance owns those semantics.

**Aggregates:** `Tenant`, `Principal`.

**Published events:** `TenantActivated`, `TenantSuspended`, `PrincipalProvisioned`, `MembershipGranted`, `MembershipRevoked`, `SessionsRevoked`.

**SLO:** authorization subject resolution p99 < 100 ms in-region; suspension/revocation propagation p99 < 60 seconds.

## 2. Deliberation

**Ubiquitous language:** deliberation case, decision contract, option, stakeholder, deadline, recorded decision, closure.

**Responsibilities:** authoritative decision intent and lifecycle. It determines what question is being decided, by whom, within what scope, and when a brief is eligible to influence a recorded human decision.

**Aggregates:** `DeliberationCase`.

**States:** `draft -> scoped -> ready -> running -> review -> decided -> closed`; `cancelled` is terminal from any pre-decision state. Reopening creates a new revision, never mutates history.

**Published events:** `DeliberationScoped`, `DeliberationReady`, `PlanningRequested`, `HumanDecisionRecorded`, `DeliberationClosed`, `DeliberationCancelled`.

**Inbound:** entitlement and governance decisions; brief publication notice.

## 3. Preferences

**Ubiquitous language:** criterion, weight, veto, risk bound, trade-off, preference snapshot.

**Responsibilities:** explicit user/team values, multi-stakeholder preference sets, version history, conflict disclosure, and immutable snapshots consumed by a run.

**Aggregates:** `PreferenceProfile`.

**Rules:** weights are normalized within a scoring view; vetoes remain hard constraints; inferred preferences are never promoted without confirmation; stakeholder conflicts are represented rather than averaged away.

**Published events:** `PreferenceProfileCreated`, `PreferenceCriterionChanged`, `PreferenceSnapshotPublished`.

## 4. Evidence

**Ubiquitous language:** evidence record, source, claim, provenance, epistemic class, freshness, supersession, trust assessment.

**Responsibilities:** source ingestion, immutable content hashing, claim extraction, provenance chain, retention label, sensitivity classification, and correction/supersession.

**Aggregates:** `EvidenceRecord`.

**Epistemic classes:** `observed-fact`, `user-assertion`, `external-claim`, `estimate`, `assumption`, `model-inference`, `simulated-result`.

**Rules:** generated text cannot become observed fact; missing provenance blocks “verified” status; source changes create a new version; retrieval preserves tenant and purpose constraints.

**Published events:** `EvidenceIngested`, `EvidenceClassified`, `EvidenceSuperseded`, `EvidenceErasureRequested`.

## 5. Scenario Planning

**Ubiquitous language:** scenario tree, branch, assumption set, action, transition, rollout, expansion policy, budget, diversity.

**Responsibilities:** bounded search, branch lineage, assumptions, worker leases, model/tool invocations, budget enforcement, cancellation, and reproducibility manifests.

**Aggregates:** `ScenarioTree`.

`ScenarioBranch` is an entity inside `ScenarioTree`, not an independent aggregate: branching, parentage, depth limits, and budget allocation require one consistency boundary. Large trees may be physically segmented while preserving logical aggregate invariants via a tree coordinator.

**States:** `planned -> active -> evaluating -> completed`; `cancelled`, `failed`, and `budget-exhausted` are terminal.

**Rules:** no branch runs without frozen inputs; no child outlives a cancelled tree; leased steps are idempotent; branch diversity is measured; same-model samples are not labeled independent.

**Published events:** `ScenarioTreeStarted`, `BranchExpanded`, `BranchPruned`, `PlanningBudgetExhausted`, `ScenarioTreeCompleted`.

## 6. Evaluation

**Ubiquitous language:** verifier, finding, scorecard, hard constraint, Pareto frontier, sensitivity, dissent, confidence, abstention, decision brief.

**Responsibilities:** verifier execution, evidence-quality assessment, score aggregation, dominance analysis, sensitivity analysis, uncertainty communication, abstention, and immutable brief publication.

**Aggregates:** `EvaluationRun`, `DecisionBrief`.

**Rules:** hard-constraint failure cannot be masked by utility; generic LLM judgment alone cannot produce “verified”; all scores cite their rubric and inputs; brief publication fails closed if provenance is incomplete; an abstention is a successful safe outcome.

**Published events:** `EvaluationStarted`, `VerificationCompleted`, `EvaluationAbstained`, `DecisionBriefPublished`, `DecisionBriefSuperseded`.

## 7. Governance

**Ubiquitous language:** policy set, risk tier, purpose, consent, approval, retention, legal hold, erasure.

**Responsibilities:** versioned policy evaluation, decision-domain risk classification, tool approval, consent receipts, retention/erasure orchestration, legal hold, and human-review requirements.

**Aggregates:** `PolicySet`, `ConsentRecord`.

**Rules:** deny overrides allow; policy version is recorded on every authorization; consent is purpose-specific and revocable; legal hold blocks physical erasure but not access restriction; consequential domains require configured human review.

**Published events:** `PolicySetActivated`, `ConsentGranted`, `ConsentWithdrawn`, `ErasureOrdered`, `LegalHoldApplied`.

## 8. Learning

**Ubiquitous language:** outcome record, prediction, observation, calibration cohort, learning candidate, evaluation gate, promotion, rollback.

**Responsibilities:** predicted-versus-observed pairing, outcome capture, calibration metrics, drift detection, candidate training/derivation, offline evaluation, promotion approvals, and rollback.

**Aggregates:** `OutcomeRecord`, `LearningCandidate`.

**Rules:** generated outcomes never count as observations; outcome corrections are versioned; minimum cohorts and privacy thresholds are policy-driven; candidate author cannot be sole approver; production promotion requires held-out improvement and non-regression; raw user data is excluded from global learning by default.

**Published events:** `OutcomeObserved`, `CalibrationComputed`, `LearningCandidateProposed`, `LearningCandidatePromoted`, `LearningCandidateRolledBack`.

## 9. Integrations

**Ubiquitous language:** connector, capability, credential reference, MCP server, tool, resource, approval mode, health.

**Responsibilities:** connector registration, capability discovery, schema pinning, credential indirection, tenant grants, egress restrictions, circuit breaking, and audit of external calls.

**Aggregates:** `ConnectorRegistration`.

**Rules:** credentials never enter domain events; newly discovered capabilities are disabled by default; write tools require explicit policy; schemas are pinned per run; remote content is untrusted input.

**Published events:** `ConnectorRegistered`, `CapabilityApproved`, `ConnectorQuarantined`, `CredentialRotationRequested`.

## 10. Commercial Operations

**Ubiquitous language:** plan, entitlement, quota, reservation, consumption, overage, billing account.

**Responsibilities:** commercial plans, feature entitlements, quota reservation, usage metering, invoice-provider reconciliation, trials, suspension grace periods, and enterprise contract overrides.

**Aggregates:** `Entitlement`.

**Rules:** a planning run reserves its maximum budget before execution; consumption is idempotent; metering never exposes deliberation content; billing failure cannot erase customer data; governance limits override commercial entitlement.

**Published events:** `EntitlementChanged`, `QuotaReserved`, `UsageConsumed`, `QuotaReleased`, `CommercialAccessSuspended`.

## Integration matrix

| Consumer | Provider | Contract | Consistency |
|---|---|---|---|
| All contexts | Identity | authenticated subject + tenant claims | synchronous/cache with revocation |
| Deliberation/Planning/Integration | Governance | authorize command/tool/purpose | synchronous, fail closed |
| Planning | Deliberation/Preferences/Evidence | immutable run input manifest | snapshot at start |
| Evaluation | Planning/Evidence/Preferences | completed scenario manifest | event + idempotent query |
| Deliberation | Evaluation | published brief reference | event |
| Learning | Deliberation/Evaluation | recorded choice, predictions, outcomes | events |
| Commercial Operations | Planning | reservation/consumption | synchronous reserve, async reconcile |
| Evidence | Integrations | fetched artifact + provenance envelope | command/result |

## Anti-corruption boundaries

- External identity claims map into internal principals; provider roles never become internal authorization decisions directly.
- MCP tool schemas map into a versioned capability contract; arbitrary server payloads never enter the domain unchanged.
- Model-provider responses map into generated-artifact envelopes with provenance and usage.
- Payment-provider subscriptions map into entitlements; provider webhook order is not trusted.
- Agenticow is hidden behind a `BranchMemoryPort`; canonical decision and evidence records do not depend on its API.
