# Domain implementation readiness standard

## Definition of done for an aggregate

An aggregate is production-ready only when all of the following exist:

- executable invariants and transition tests;
- property-based tests for value objects and state machines;
- optimistic-concurrency and idempotency tests;
- authorization tests for every command;
- repository contract tests against the production database;
- serialization/upcasting tests for every event version;
- PII classification and retention behavior;
- structured audit events without sensitive payload leakage;
- metrics for command rate, latency, rejection reason, and conflict rate;
- runbook entries for stuck workflows and repair;
- migration/backfill and rollback procedures;
- load tests at forecast peak plus agreed headroom.
- public command/query/event contracts with typed errors and compatibility fixtures;
- durable workflow crash/retry/cancel/compensation/repair tests;
- explicit entitlement, capacity admission, and usage-reconciliation behavior;
- registered projection/cache/search/export/backup retention and erasure handlers;
- approved operational owner, SLO, dashboard, alert, runbook, and rollback path.

## Cross-context acceptance journeys

### Safe deliberation

Given an authorized user, sufficient entitlement, confirmed preferences, qualifying evidence, and an allowed domain, the platform freezes inputs, completes bounded scenarios, verifies claims, publishes a provenance-complete brief, records the user's decision, and later accepts an observed outcome.

### Abstention

Given missing material evidence, verifier conflict, failed hard constraints, or excessive uncertainty, evaluation completes with a typed abstention and the brief explains what evidence or action could unblock the decision. No “winner” is selected.

### Cancellation and cost control

Cancellation prevents new leases, lets in-flight calls finish only within a short grace window, commits no late branch mutation, releases unused quota, preserves an audit trail, and produces a consistent terminal state.

### Consent withdrawal and erasure

Withdrawal blocks new purpose-bound processing immediately. Erasure locates canonical records, blobs, embeddings, branch deltas, projections, caches, exports, learning cohorts, and backups; applies legal holds; returns a signed completion/exception report.

### Connector compromise

Schema drift, identity mismatch, suspicious output, or repeated failures quarantines the connector. New calls fail closed, in-flight results are rejected, credentials are rotated out of band, and affected evidence is marked for review.

### Learning regression

A promoted candidate breaching calibration, safety, or fairness thresholds automatically rolls back to the signed prior version, stops new attribution, retains forensic evidence, and cannot be re-promoted without a new version and approval.

## Non-functional quality gates

| Concern | Release gate |
|---|---|
| Availability | tiered SLOs and error budgets; restore and regional-failure exercises pass |
| Durability | point-in-time recovery and encrypted restore tested quarterly |
| Security | threat model, SAST/SCA/secret scan, penetration test, tenant-isolation suite |
| Privacy | DPIA where applicable, retention/erasure tests, data-flow inventory |
| AI quality | frozen eval sets, calibration, citation correctness, prompt-injection suite, model fallback |
| Performance | budgets for API, queue wait, branch step, evaluation, and brief generation |
| Cost | per-run reservation, provider budgets, anomaly alerts, tenant quotas |
| Accessibility | WCAG 2.2 AA including uncertainty and chart alternatives |
| Operability | traces/logs/metrics joined by correlation ID; runbooks exercised |
| Compatibility | API/event schema checks; expand-contract database migrations |
| Audit | hash-chain verification, key rotation, signed export, forensic reconstruction |
| Enterprise lifecycle | onboarding, federation, support access, suspension, export and offboarding |
| Portability | signed versioned export; quarantined dry-run import; supported-version fixtures |

## Required test pyramid

1. Pure domain tests for all invariants.
2. Contract tests for repositories, model providers, MCP connectors, billing and identity adapters.
3. Component tests with real Postgres/object store/queue in ephemeral environments.
4. Journey tests for every workflow above.
5. Adversarial AI tests and deterministic replay fixtures.
6. Performance, soak, chaos, backup/restore, and disaster-recovery tests.
7. Production canaries and synthetic probes that contain no customer content.
8. Workflow fault injection at every durable boundary and authorization revocation point.
9. Meter/provider/invoice reconciliation and overload/noisy-neighbor exercises.

## Prohibited shortcuts

- shared database tables across contexts;
- mutable published briefs, evidence, preference snapshots, or policy versions;
- LLM-only verification of consequential claims;
- storing provider credentials in aggregate state or events;
- unbounded agent loops or unreserved model/tool spend;
- production learning from generated outcomes;
- authorization based only on UI visibility;
- hard deletion without erasure workflow evidence;
- distributed mesh introduction without a measured requirement and a new ADR.
- mutable or unversioned prompt, rubric, model route, verifier, policy, safety case, or production configuration;
- support impersonation, standing customer-content access, or unaudited break glass;
- post-filter-only tenant security for search/vector retrieval;
- treating billing-provider state, caches, projections, logs, or exports as canonical domain truth.

## Required implementation artifacts

Before general availability, the release receipt must bind the exact:

- API, event, exchange-package, database, and projection schemas;
- configuration, prompt, rubric, routing, verifier, policy, safety-case, and model digests;
- threat model, privacy/data-flow inventory, abuse analysis, and supported-use statement;
- SLOs, capacity/cost forecast, runbooks, restore/rollback results, and on-call ownership;
- contract/entitlement catalog, meter definitions, reconciliation results, and support lifecycle;
- signed build provenance, SBOM, migrations, evaluation results, approvals, and canary limits.
