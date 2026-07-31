# Deliberation Platform domain design

- **Status:** proposed
- **Date:** 2026-07-23
- **Scope:** implementation contract for the production Deliberation Platform
- **Inputs:** [initial concept](../../.plans/deliberation-initial.md), [deep research](../../.plans/deliberation-deep-research.md)

## Purpose

This package defines the business language, ownership boundaries, invariants, events, and consistency rules that implementation teams must preserve. It is not a folder-layout proposal. A feature is incomplete until its aggregate invariants, authorization policy, idempotency, audit evidence, telemetry, migration path, and tests are implemented.

The platform is a **decision laboratory**, not a future oracle. Generated scenarios are hypotheses. Evidence is provenance-bearing input. Observed outcomes are historical observations. No operation may silently convert one epistemic class into another.

## Strategic domain map

| Context | Type | Owns | Upstream dependencies |
|---|---|---|---|
| Identity & Access | Generic | tenants, principals, membership, service identities | external IdP |
| Deliberation | Core | decision contract and lifecycle | identity, governance |
| Preferences | Core | criteria, weights, vetoes, preference versions | identity |
| Evidence | Core | evidence, provenance, epistemic classification | integrations, governance |
| Scenario Planning | Core | scenario tree, branches, assumptions, rollout budgets | deliberation, evidence, preferences |
| Evaluation | Core | verification, scorecards, Pareto sets, briefs | scenarios, evidence, preferences, governance |
| Governance | Supporting | policy, consent, retention, risk classification, approvals | identity |
| Learning | Supporting | observed outcomes, calibration, candidate promotion | deliberation, evaluation, governance |
| Integrations | Supporting | connector registrations and tool capabilities | identity, governance |
| Commercial Operations | Generic | plans, entitlements, quotas, metering | identity, billing provider |

Context relationships use published domain events and explicit query contracts. No context reads another context's database tables. Identity and governance checks may be synchronous; all other cross-context propagation is asynchronous unless an ADR says otherwise.

## Core end-to-end lifecycle

```text
draft decision contract
  -> validate scope, risk and consent
  -> freeze preference + evidence snapshots
  -> authorize and budget a planning run
  -> generate diverse scenario branches
  -> verify claims and constraints
  -> evaluate multi-objective trade-offs
  -> publish or abstain from a decision brief
  -> record the human decision
  -> later capture observed outcomes
  -> calibrate and propose offline learning candidates
  -> independently approve or reject promotion
```

There is no automatic “winning-memory merge.” Promotion applies only to provenance-preserving facts, explicit user preference changes, or separately approved learning candidates.

## Shared modeling rules

1. IDs are tenant-scoped opaque UUIDv7/ULID-compatible values and are never reused.
2. Aggregates use optimistic concurrency with an integer version.
3. Commands carry `tenantId`, `principalId`, `correlationId`, and `idempotencyKey`.
4. Domain events carry aggregate version, occurred-at time, actor, tenant, correlation, causation, and schema version.
5. Time is supplied by a port; domain code never reads the system clock directly.
6. Published records are immutable. Corrections append superseding versions.
7. Money uses currency-tagged decimal minor units; probabilities are bounded decimal values with calibration provenance.
8. All user-visible scoring distinguishes facts, estimates, assumptions, model inferences, and observed outcomes.
9. Hard constraints cannot be traded away by weighted scoring.
10. Delete is a governed erasure workflow, not a repository `DELETE` shortcut.

## Aggregate catalog

Detailed aggregate contracts are in [aggregate-catalog.md](./aggregate-catalog.md). Context interaction and event ownership are in [context-map.md](./context-map.md). Quality gates are in [implementation-readiness.md](./implementation-readiness.md).

## Implementation specification set

| Document | Binding implementation concern |
|---|---|
| [Context map](./context-map.md) | ownership, dependencies, language, published facts |
| [Aggregate catalog](./aggregate-catalog.md) | consistency boundaries, state, commands, invariants |
| [Application contracts](./application-contracts.md) | command/query/event envelopes, idempotency, errors, webhooks |
| [Workflow specifications](./workflow-specifications.md) | durable sagas, retries, cancellation, compensation, repair |
| [Authorization and audit](./authorization-and-audit.md) | roles, policy inputs, obligations, approvals, break glass |
| [Data and projection contracts](./data-and-projection-contracts.md) | storage ownership, classification, migration, search, cache, erasure |
| [Capability and entitlement model](./capability-and-entitlement-model.md) | plans, contracts, features, quotas, reservations, reconciliation |
| [Operational model](./operational-model.md) | SLOs, incidents, runbooks, capacity, continuity, release receipts |
| [Implementation readiness](./implementation-readiness.md) | aggregate and cross-context production gates |

These documents are normative together. A generated type or database schema that contradicts a domain invariant is defective even if it compiles. When a contract is intentionally changed, update its ADR, affected domain specifications, compatibility/migration plan, and executable acceptance evidence in the same change.

## Required architecture tests

- Domain packages do not import infrastructure packages.
- Public context APIs never export infrastructure adapters.
- Cross-context imports target published contracts only.
- Aggregate repositories expose aggregate operations, not arbitrary query builders.
- Every externally consumed event has a compatibility test.
- Every state transition has an invariant test and an authorization test.
- Every generated artifact retains model, prompt, evidence, and tool provenance.
- Every public action has an explicit authorization, entitlement, idempotency, audit, and failure contract.
- Every durable workflow is restartable at each step and has bounded retry, cancellation, compensation, and repair evidence.
- Every projection, cache, search index, export, and backup participates in tenant isolation, retention, and erasure.
