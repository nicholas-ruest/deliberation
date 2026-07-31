# Data, storage, and projection contracts

This document converts persistence ADRs into implementable ownership and lifecycle rules.

## Data classes

| Class | Examples | Default controls |
|---|---|---|
| Public | published product docs, public model metadata | integrity and provenance |
| Internal | service configuration metadata, non-sensitive metrics | workforce/workload access only |
| Confidential | decision contracts, preferences, evidence, briefs | tenant isolation, encryption, purpose, retention |
| Restricted | identity attributes, legal/health/financial evidence, secrets-adjacent data | field encryption, strict purpose, access audit, provider restrictions |
| Credential | API keys, tokens, private keys | secret store only; never domain/event/log |

Epistemic class and sensitivity class are independent. An observed fact may be restricted; a simulated result may be public.

## Canonical stores by context

Each context owns a PostgreSQL schema, migrations, repository interfaces, outbox, inbox, and projection checkpoints. Database roles prevent cross-schema writes and routine cross-schema reads. Cross-context foreign keys are prohibited; store opaque references and validate through contracts/workflows.

| Context | Canonical records | Not canonical |
|---|---|---|
| Identity & Access | tenants, principals, memberships, session epochs | IdP profiles, access-token claims |
| Deliberation | cases, revisions, recorded decisions | rendered brief bytes |
| Preferences | profiles, criteria, immutable snapshots | inferred temporary suggestions |
| Evidence | metadata, claims, provenance, blob references | source-provider mutable objects |
| Scenario Planning | trees, lineage, leases, budgets, manifests | branch-memory adapter payload as truth |
| Evaluation | runs, findings, scorecards, brief manifests | search ranking or rendered previews |
| Governance | policies, safety cases, consent, hold/erasure orders | policy-engine cache |
| Learning | observations, cohorts, candidates, promotions | generated outcomes |
| Integrations | connector/capability registrations, call receipts | credentials, remote schema as live truth |
| Commercial Operations | plans, entitlements, reservations, usage ledger | billing-provider webhook state |

Large immutable content uses encrypted object storage addressed by an opaque object ID and verified content digest. Object keys do not contain tenant names, user identifiers, titles, or source URLs. Object metadata is non-sensitive; canonical classification remains in PostgreSQL.

## Required record columns

Tenant-owned rows include `tenant_id`, opaque ID, aggregate/version where relevant, creation/update timestamps, classification, retention-policy reference, and erasure state. Mutable aggregate rows use an optimistic version. Immutable versions have a unique logical ID/version and supersession edge.

Database transactions set a signed/validated tenant session context and row-level policy as defense in depth. Repository methods still include tenant predicates. Connection pools reset session state on checkout/check-in and tests attempt tenant-context confusion.

## Encryption and key hierarchy

Managed KMS/HSM protects platform root and regional keys. Tenant key-encryption keys wrap purpose/data-class keys; restricted object/field data uses envelope encryption with authenticated context binding tenant, record, class, and version. Rotation rewraps data keys where possible. Key versions and cryptographic operations are auditable; plaintext keys never enter application logs or durable queues.

Cryptographic erasure destroys the narrowest applicable wrapping key only after verifying shared-key blast radius. Data under legal hold uses separate hold keys or is made inaccessible without destroying required evidence.

## Migration contract

Every migration has owner, forward SQL/tooling, compatibility window, backfill checkpoint, validation query/digest, performance estimate, lock budget, rollback or forward-repair strategy, and backup prerequisite.

Use expand/migrate/contract:

1. add backward-compatible schema;
2. deploy dual-read or dual-write only when reconciliation is defined;
3. backfill in tenant-bounded, throttled, resumable batches;
4. validate counts, constraints, hashes, and application metrics;
5. switch reads through versioned configuration;
6. retain rollback window;
7. remove old shape in a later release.

Destructive migration never shares a release with the first reader of the replacement. Large table changes are rehearsed on production-shaped data. Failed backfills cannot block security, cancellation, or erasure traffic.

## Projection registry

Every derivative is registered with:

```text
name, owner, purpose, data classes, regions,
source events + versions, schema/model version,
checkpoint type, consistency class, freshness SLO,
retention/erasure handler, rebuild runbook, consumers
```

Projection records carry tenant, source record/version, source watermark, policy-relevant labels, and projection version. A projection may enrich only from published authorized inputs and records lineage for each enrichment.

Full-text and vector retrieval apply tenant/purpose/classification filters before scoring. Post-filtering alone is prohibited. Retrieval responses return source identity, version, provenance, epistemic class, score semantics, and projection watermark.

## Cache contract

- Cache only serialized authorized views or non-sensitive owner data.
- Keys bind tenant, resource/version, subject/visibility cohort, purpose, locale, and representation version as needed.
- Never cache raw policy allows without session epoch and policy/resource versions.
- Restricted data uses encryption and the shortest policy-approved TTL.
- Negative caching cannot reveal cross-tenant existence.
- Revocation/withdrawal/hold/erasure writes a deny marker before asynchronous eviction when immediate restriction is required.

## Retention and erasure registry

Every table, object prefix, projection, cache, export, backup, log, model/provider transfer, and subprocess owner declares:

- data classes and purposes;
- authoritative owner and locator strategy;
- default/contractual/legal retention;
- legal-hold behavior;
- erasure/restriction command and evidence;
- backup expiry/restoration behavior;
- whether anonymization is irreversible and how verified.

Unknown inventory entries block an erasure completion claim and production readiness for the owning capability.

## Backup and recovery

Backups are encrypted, immutable for their retention window, region/policy compliant, and isolated from production credentials. Restore creates a quarantined environment, verifies signatures/checksums, applies migrations plus erasure deny-list, and runs tenant/invariant reconciliation before traffic. Restore tests measure actual RPO/RTO and verify audit-chain continuity.

## Acceptance evidence

- Repository contract suites run against production-version PostgreSQL with row-level policy enabled.
- Cross-tenant fuzzing covers pooled connections, jobs, projections, caches, search, exports, and restore.
- Migration rehearsals demonstrate bounded locks, pause/resume, reconciliation, and rollback/forward repair.
- Retention inventory reconciliation and representative end-to-end erasure pass for every data class.
