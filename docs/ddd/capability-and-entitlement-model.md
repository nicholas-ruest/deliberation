# Capability and entitlement model

Commercial packaging controls what a customer purchased. Governance controls what is safe and lawful. Capacity controls what can execute now. A request proceeds only when all three permit it; commercial entitlement never overrides governance.

## Commercial aggregates

### ProductPlan

`ProductPlan` is a versioned catalog aggregate owned by Commercial Operations.

It owns feature codes, included quota dimensions, overage policy, service tier, support tier, retention choices, connector/model classes, and effective interval. Published plan versions are immutable. Price-book details may remain in the billing provider, but the platform stores the contractual behavior required to authorize service.

### CustomerContract

`CustomerContract` binds a tenant/billing account to plan version, negotiated overrides, regions, term, service/support commitments, data terms, invoice reference, and effective interval.

Invariants:

- an override names a supported feature/dimension and approval authority;
- effective intervals do not overlap ambiguously;
- a contract cannot weaken platform safety/privacy minima;
- termination does not imply data deletion;
- renewal produces a new version.

### Entitlement

The existing `Entitlement` aggregate is the runtime materialization of the current contract. It exposes a stable `check(feature, context)` and reservation protocol; application code never branches on plan names.

## Stable feature codes

Feature codes are semantic capabilities such as:

- `deliberation.case.create`
- `planning.scenario.run`
- `evaluation.brief.publish`
- `integration.connector.read`
- `integration.connector.write`
- `learning.outcome.track`
- `enterprise.sso`
- `enterprise.scim`
- `governance.custom-policy`
- `audit.export`
- `data.exchange.export`
- `support.priority`

Codes are additive and documented. Removal uses contract deprecation. UI visibility is derived from entitlement but server-side command checks remain authoritative.

## Quota dimensions

| Dimension | Unit | Enforcement |
|---|---|---|
| planning runs | count/window | reserve one, consume terminally |
| model usage | provider-normalized tokens and money | reserve maximum; reconcile actual |
| tool calls | count/class | decrement before call |
| branch work | branches/steps/concurrency | orchestrator hard limit |
| storage | encrypted bytes by class | ingest reservation and periodic reconcile |
| users | active principals | provisioning check with grace policy |
| connectors | active registrations/class | activation check |
| exports | bytes/jobs/window | admission + streaming meter |

Meters use stable dimension, unit, measurement version, source receipt, event time, tenant, reservation/workflow, and deduplication ID. They contain no customer content, decision title, prompt, evidence, option, or brief text.

## Reservation protocol

1. Estimate upper bounds using a versioned estimator and frozen request.
2. Atomically create a reservation against entitlement buckets.
3. Admission binds execution to reservation ID and expiry.
4. Each paid effect checks local remaining amount before invocation.
5. Immutable usage receipts decrement the reservation idempotently.
6. Completion/cancellation releases unused amount.
7. Reconciliation compares provider receipts, orchestration manifests, and ledger totals.

Reservation is not billing capture and billing capture is not proof of successful domain work. Uncertain provider outcomes enter reconciliation; they are not double charged on retry.

## Plan and contract changes

- Upgrade: new entitlements may take effect immediately or at a scheduled time.
- Downgrade: existing immutable records remain readable/exportable according to contract; new work uses new limits; over-limit resources enter managed read-only/grace state rather than deletion.
- Payment failure: applies contractual grace and work restrictions; never erases data or disables security/export rights required by policy.
- Security suspension: overrides commercial status and protects read/export according to incident policy.
- Termination: stops new chargeable work, reconciles usage, then enters offboarding.

Long-running workflows retain the entitlement snapshot/reservation accepted at start unless a security/governance suspension requires cancellation. A commercial downgrade does not silently change a frozen run’s model or verifier.

## Usage and invoice reconciliation

Daily reconciliation proves:

```text
accepted reservation
  >= sum(valid usage receipts)
  >= sum(provider-confirmed paid effects attributed to the run)
```

Exceptions include duplicate, missing, late, mismatched-unit, unknown-price, and disputed receipts. Corrections append adjustment entries; consumed history is never overwritten. Invoice aggregates are compared with platform totals by contract, time window, dimension, currency, and tax-exclusive amount.

Customers can view usage totals, estimator version, quota state, and adjustment reason without exposure to internal provider discounts or other tenants. Billing disputes freeze destructive collection actions while preserving evidence.

## Trial and abuse controls

Trials have verified customer identity, isolated entitlements, hard spend/storage/concurrency ceilings, expiry, conversion/offboarding path, and abuse monitoring. Abuse decisions use documented signals and appeal/support workflow; they do not silently reuse customer content for risk training.

## Service and support tiers

Service tier selects published SLO targets, recovery targets, maintenance notice, support severity response, and capacity class. It cannot select weaker integrity, isolation, audit, or safety requirements. Service credits and reports derive from canonical SLI windows with documented exclusions and approval.

## Acceptance evidence

- Catalog and contract property tests cover effective dates, overrides, upgrade/downgrade, grace, and termination.
- Reservation tests cover concurrency, expiry, cancellation, crash recovery, provider uncertainty, and adjustment.
- Meter-to-provider-to-invoice reconciliation passes exact fixtures and high-volume duplicate/out-of-order streams.
- A plan change cannot bypass policy or mutate frozen run inputs.
