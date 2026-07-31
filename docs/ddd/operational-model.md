# Operational model and production acceptance

Production readiness is a maintained capability, not a launch milestone. This document defines ownership, service levels, failure handling, and evidence required to operate the bounded contexts.

## Service catalog

Every deployable service/worker has:

```text
owner and escalation rotation
bounded contexts and data classes
dependencies and provider limits
regions/cells and tenant routing
SLIs/SLOs and error-budget policy
capacity model and scaling limits
RTO/RPO and backup tier
dashboards, alerts, runbooks and synthetic probes
deployment/configuration/artifact identity
```

No unowned component or external dependency is production critical. Third-party status is a signal, not a substitute for internal measurements.

## Initial service objectives

Targets are initial product contracts subject to approved revision; lower environments must test their measurement logic.

| Capability | SLI | Initial objective |
|---|---|---|
| Authenticated command API | good responses excluding valid denials | 99.9% monthly |
| Interactive query API | availability and latency | 99.9%; p95 < 500 ms, p99 < 1.5 s in-region |
| Authorization decision | availability and latency | 99.99%; p99 < 100 ms in-region |
| Accepted planning work | starts or returns honest capacity state | 99.5% within tier queue-age target |
| Cancellation | no new leases and terminal convergence | p99 stop-admission < 5 s; converge < 2 min |
| Brief publication after completed evaluation | successful immutable publication | 99.5% within 5 min, excluding required human wait |
| Revocation/consent restriction | no newly authorized affected processing | p99 < 60 s; stricter policy may require immediate |
| Audit sealing | accepted records sealed/anchored | 99.99% < 5 min; no silent loss |
| Erasure order | completion or explicit lawful exception | tier/policy target, continuously visible |
| Usage reconciliation | attributed receipts reconciled | 99.9% by 24 h; 100% before invoice close |

Latency excludes client network but includes platform dependencies. Valid policy denial, abstention, and quota rejection are correctly handled outcomes, not availability failures. Incorrect allow, cross-tenant disclosure, silent provenance loss, unmetered paid effect, or audit loss always counts as bad.

## Error budgets and release policy

Each SLO has a rolling error budget and burn alerts. Fast burn pages the owner and freezes risky rollout in the affected scope. Exhausted budget permits only security, compliance, reliability, observability, and approved emergency changes until recovery evidence is accepted. Teams cannot redefine an SLI window to erase an incident.

Safety, tenant isolation, audit integrity, data loss, and unauthorized external action are zero-tolerance correctness properties; an “error budget” does not authorize them.

## Observability

Metrics, traces, and structured logs carry service, version, environment, region/cell, operation, outcome/reason, correlation, workflow, dependency, and tenant-safe pseudonymous bucket. They exclude prompts, evidence, preferences, brief text, tokens, credentials, and raw subject IDs by default.

Required golden signals include:

- rate, errors, latency, saturation, queue age, and deadline expiry;
- workflow state age, retries, compensation, cancellation, and dead-letter count;
- provider/model/tool latency, outcome, circuit state, and attributed cost;
- policy allow/deny/obligation reason distribution;
- projection lag/rebuild, outbox/inbox age, and audit sealing lag;
- reservation leakage, usage reconciliation delta, and per-tenant fairness;
- AI quality/safety indicators tied to exact artifact and safety-case versions.

High-cardinality debugging uses controlled trace sampling and audited tenant-scoped diagnostic capture, not unbounded metric labels.

## Incident management

Severity is based on customer/safety impact:

- `SEV-0`: confirmed cross-tenant disclosure, uncontrolled harmful external action, irrecoverable data/audit integrity loss, or broad credential compromise;
- `SEV-1`: major regional/cell outage, suspected isolation breach, publication safety control failure, or widespread paid-work corruption;
- `SEV-2`: material degradation or tenant-scoped blocked critical journey;
- `SEV-3`: limited defect with workaround and no material safety/data risk.

Response establishes incident command, containment, evidence preservation, customer/security/legal communication tracks, and a decision log. Containment may quarantine connectors/models, stop publications, revoke credentials, or isolate a cell while preserving cancel/export/security paths. Never destroy forensic evidence to restore service.

Post-incident review is blameless but accountable: timeline, contributing system conditions, control effectiveness, customer impact, detection gaps, corrective owners/dates, and safety-case/ADR updates. Corrective work is verified, not closed by code merge alone.

## Runbook minimum

Runbooks exist and are exercised for:

- database failover, point-in-time restore, and migration failure;
- queue backlog, poison message, stuck/duplicated workflow, and compensation repair;
- identity/policy outage, mass revocation, and break glass;
- model provider outage/quality regression and connector quarantine;
- object/vector/search corruption and projection rebuild;
- cost anomaly, reservation leak, and billing reconciliation failure;
- audit sealing/export failure and signing-key rotation;
- consent withdrawal/erasure failure and legal hold;
- region/cell evacuation and tenant migration;
- release rollback and configuration/prompt/model artifact rollback.

Every runbook states preconditions, authority, customer impact, exact safe checks, rollback/stop conditions, evidence captured, and verification. Commands that can mutate production are automated, scoped, previewable, and require current capabilities.

## Capacity and continuity

Capacity models include forecast tenants, interactive/batch mix, branch fan-out, provider quotas, storage/index growth, replay/rebuild demand, and failover headroom. Quarterly tests exercise peak plus agreed headroom and one critical dependency/cell unavailable.

Backups are not accepted until restore proves application invariants, tenant isolation, audit continuity, erasure replay, and usable RTO/RPO. Regional failover occurs only to policy-approved residency and providers. If no compliant failover exists, return a clear unavailable state and preserve data rather than crossing policy.

## Production release evidence

A release receipt binds:

- clean commit or immutable source snapshot including generated contracts;
- dependency lock, SBOM, build provenance, image/package signatures;
- database and projection migration versions;
- configuration, prompt, policy, rubric, router, model, verifier, and connector allowlist digests;
- focused, regression, adversarial, performance, accessibility, restore, and rollback results;
- risk assessment, change approvals, canary scope, automated stop thresholds, and prior rollback digest.

The release controller independently verifies the receipt and current authorization. CI success alone cannot promote. Canary observes both system SLOs and domain/AI safety metrics; scope expansion is a separate authorized transition.

## Operational acceptance review

Before a capability becomes generally available:

1. service owner and on-call coverage are named;
2. threat model, privacy flow, safety case, and abuse analysis are current;
3. dashboards alert on customer outcomes rather than process presence alone;
4. runbooks, restore, rollback, quarantine, and erasure have been exercised;
5. support and customer documentation state limitations and recovery paths;
6. capacity/cost model passes forecast load and failure headroom;
7. contract, entitlement, metering, audit, export, and offboarding paths pass;
8. an independent reviewer verifies evidence against exact release inputs.

General availability is denied when a required owner, runbook, evidence artifact, or safe rollback is missing.
