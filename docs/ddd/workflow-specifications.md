# Durable workflow specifications

Workflows coordinate aggregates without pretending that distributed work is atomic. Every workflow has a persisted state, version, tenant, owner context, deadline, retry budget, compensation state, audit references, and operator-visible repair status. Activities are idempotent and fenced; timers use durable time.

## Common execution rules

- A workflow transition and its outgoing activity/event intent are persisted atomically.
- Activity identity is `(workflowId, stepName, attemptGeneration)`; a stale generation cannot commit.
- Retry only typed transient failures, with exponential backoff, jitter, deadline, and financial/tool budgets.
- Business denial, invalid input, prohibited risk, and failed hard constraints do not retry.
- Compensation is forward recovery and idempotent; it does not erase audit or already-observed external effects.
- Cancellation stops admission and new leases first, then propagates. Late results are retained as diagnostics but cannot mutate terminal domain state.
- A dead-lettered workflow records the blocked step, safe customer state, last error class, repair options, and escalation owner.
- Manual repair is a command with authorization, expected workflow version, rationale, and audit receipt.

## Start planning run

```text
requested
 -> validating-contract
 -> authorizing
 -> reserving-entitlement
 -> admitting-capacity
 -> freezing-inputs
 -> creating-tree
 -> running
 -> evaluating
 -> completed
```

Terminal alternatives are `rejected`, `cancelled`, `budget-exhausted`, `abstained`, and `failed`.

| Step | Owner | Durable output | Compensation/failure |
|---|---|---|---|
| Validate contract | Deliberation | eligible case revision | reject with violations |
| Authorize | Governance | policy decision + obligations | reject/freeze if unsupported |
| Reserve entitlement | Commercial Operations | reservation | release unused amount |
| Admit capacity | Operations/Planning | capacity lease | retry without holding scarce reservation beyond TTL |
| Freeze inputs | Preferences/Evidence/Deliberation | signed run-input manifest | mark abandoned; immutable |
| Create tree | Scenario Planning | tree ID and root | cancel tree and reject leases |
| Run branches | Scenario Planning | step manifests and usage | stop leases; reconcile usage |
| Evaluate | Evaluation | evaluation/abstention | retain scenarios; no brief if invalid |
| Publish/attach | Evaluation/Deliberation | immutable brief reference | retry event delivery; never duplicate attachment |

Only one active workflow exists per `(caseId, revision)`. The initiating idempotency result points to it. Resume loads persisted inputs; it never silently refreshes evidence, preferences, model policy, or safety case.

## Publish decision brief

Preconditions are a completed evaluation, current safety-case compatibility, complete provenance, satisfied review obligations, and an unexpired case revision.

The workflow composes a deterministic content manifest, validates material-claim citations and disclosures, records required human review, stores immutable renderings, signs the publication manifest, commits `DecisionBriefPublished`, and delivers the reference to Deliberation through the outbox. If attachment is delayed, the brief remains published but the case reports `publication-pending-attachment`.

Publication failure never falls back to an unsigned or less complete brief. Supersession creates a new brief and an edge to the prior version.

## Consent withdrawal and erasure

```text
ordered -> access-restricted -> discovered -> held-or-erasing
        -> canonical-erased -> derivatives-erased -> recovery-expiry-scheduled
        -> verified -> completed-with-proof
```

1. Governance records the order and immediately denies new affected processing.
2. A data inventory resolves records across schemas, blobs, vectors, projections, caches, exports, support bundles, learning cohorts, and subprocessors.
3. Legal hold partitions items into restricted-but-retained and erasable sets.
4. Each owner executes an idempotent erasure/restriction command and returns signed evidence.
5. Tenant keys are destroyed where cryptographic erasure is selected.
6. Backups expire through documented schedules; restored backups replay the erasure deny-list before service.
7. Verification reconciles inventory against completion evidence and produces exceptions with owner and lawful basis.

The customer result distinguishes completed, retained-under-hold, awaiting-backup-expiry, and failed items. “Completed” cannot be returned while an unknown owner remains.

## Enterprise onboarding

States are `requested -> verified -> allocated -> identity-configured -> policy-configured -> commercial-configured -> readiness-check -> active`. Failure enters `action-required` or `rolling-back`.

Allocation is idempotent by customer/contract identity. Activation requires at least two recoverable owner identities, verified region/cell, encryption reference, policy baseline, entitlement, audit readiness, and a successful synthetic journey. Partial resources remain inaccessible to customer workloads. Rollback revokes access, releases capacity, and schedules safe cleanup without deleting contract/audit evidence.

## Connector registration and invocation

Registration verifies endpoint identity, discovers capabilities without enabling them, scans/pins schemas, attaches credential reference, evaluates egress/data policy, and requires capability approval. Invocation freezes the capability/schema/policy version, obtains a short-lived credential, sends a minimized request, validates/scans the response, records usage/provenance/audit, and only then returns a typed result.

Identity mismatch, schema drift, policy change, suspicious content, or failure threshold opens the circuit and may quarantine the registration. An in-flight response after quarantine cannot become evidence without explicit review.

## Learning promotion

Promotion stages are `candidate-frozen -> independently-evaluated -> approved -> canary -> observed -> promoted` with `rejected`, `rolled-back`, and `expired` terminals.

The workflow binds candidate digest, derivation manifest, held-out sets, baseline digest, metrics, safety envelope, approvers, and target routing scope. Canary traffic is eligible by policy and cannot expand its own scope. Breach rolls routing back to the signed prior artifact and freezes the candidate. Promotion cannot publish a mutable tag; it activates an immutable digest through the release gate.

## Tenant offboarding

Offboarding freezes new paid work, settles/reconciles reservations, produces authorized export, revokes connectors and workload identities, applies retention/legal hold, restricts access, erases eligible data, schedules backup/key expiry, and issues a signed completion report. Commercial cancellation alone never deletes data. Reactivation is a new authorized transition and cannot revive destroyed keys.

## Workflow acceptance matrix

For each workflow, test:

- crash before and after every durable boundary;
- duplicate, delayed, out-of-order, and missing events;
- stale worker and repair fencing;
- cancellation during every nonterminal state;
- policy/entitlement/configuration change mid-flight;
- deadline, quota, capacity, and dependency exhaustion;
- compensation failure and operator repair;
- audit and customer-visible status at every terminal state.
