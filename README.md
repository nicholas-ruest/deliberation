<p align="center">
  <img src="./docs/assets/deliberation-hero.svg" alt="Deliberation Platform — evidence-grounded decisions with human authority" width="100%">
</p>

<p align="center">
  <strong>Evidence-grounded decision infrastructure for consequential choices.</strong>
</p>

<p align="center">
  TypeScript · Domain-Driven Design · PostgreSQL · Kubernetes · OpenTelemetry
</p>

---

## Overview

Deliberation Platform is a human-authority decision laboratory for organizations that need to explore options, test assumptions, evaluate trade-offs, and preserve an auditable chain of evidence without delegating the final decision to an AI system.

The platform models generated scenarios as hypotheses, keeps facts and inferences visibly distinct, preserves stakeholder disagreement, and supports explicit abstention when evidence or confidence is insufficient. Every consequential decision remains an authenticated human action.

This repository contains a TypeScript domain-aligned modular monolith with independently runnable API, worker, and web processes. It includes contract-first APIs and events, tenant-aware persistence foundations, durable workflow contracts, policy-enforced integrations, release evidence, and production-oriented Kubernetes controls.

> **Project status:** pre-1.0. Local quality gates and deterministic acceptance suites are implemented. Managed-cloud, external-provider, disaster-recovery, identity-federation, and assisted-accessibility exercises remain environment-qualified release gates. See [Production readiness](#production-readiness).

## Why Deliberation Platform

Enterprise decision systems often collapse uncertainty into a score, hide dissent, or treat model output as authority. Deliberation Platform takes a different approach:

| Principle | Platform behavior |
|---|---|
| Human authority | AI output can inform a decision but cannot record the human decision. |
| Evidence before assertion | Material claims carry provenance, classification, freshness, and derivation. |
| Honest uncertainty | Abstention, limitations, sensitivity, and missing evidence remain first-class outputs. |
| Hard constraints stay hard | Vetoes, policy restrictions, consent, residency, and risk bounds cannot be traded away by weighted scoring. |
| Tenant isolation | Identity, storage, messaging, caches, telemetry, and execution remain tenant and purpose scoped. |
| Reproducible operations | Model routes, prompts, tools, evidence, artifacts, approvals, and releases are versioned and digest bound. |
| Fail-closed dependencies | Unknown, expired, drifted, or quarantined providers cannot execute production work. |

## Platform capabilities

- Decision contracts with explicit scope, success criteria, authority, deadlines, risk, and constraints
- Stakeholder-specific preferences, vetoes, immutable snapshots, and conflict analysis
- Provenance-bearing evidence with epistemic classification and governed retention
- Budgeted scenario planning with isolated branch memory and cancellation controls
- Multi-objective evaluation, Pareto analysis, verification precedence, and typed abstention
- Decision briefs with citations, assumptions, limitations, dissent, and sensitivity
- Consent, purpose, policy, human-review, and step-up authorization obligations
- Contract-first model and connector gateways with schema validation and quarantine fencing
- Observed-outcome learning with independent promotion, canaries, and rollback
- Tamper-evident audit, cryptographic erasure workflows, telemetry, SLOs, and release gates
- Regional cell placement, Kubernetes workload isolation, and signed release foundations
- Accessible server-rendered web foundations that preserve human-authority boundaries

## Architecture

The platform is a modular monolith organized around ten bounded contexts. Each context owns its domain model, application services, contracts, persistence schema, and infrastructure adapters. Contexts integrate through published contracts and versioned events; they do not read one another's tables or import implementation internals.

```mermaid
flowchart LR
    Web[Accessible Web] --> Edge[Trusted API Edge]
    Edge --> IA[Identity & Access]
    Edge --> D[Deliberation]
    D --> P[Preferences]
    D --> G[Governance]
    D --> E[Evidence]
    E --> SP[Scenario Planning]
    P --> SP
    G --> SP
    SP --> EV[Evaluation]
    EV --> DB[Decision Brief]
    DB --> HD[Human Decision]
    HD --> L[Learning]
    I[Integrations] --> E
    C[Commercial Operations] --> SP
```

### Bounded contexts

| Context | Responsibility |
|---|---|
| Identity & Access | Tenants, principals, memberships, federation, sessions, and service identities |
| Deliberation | Decision contracts, lifecycle, revisions, and human decision records |
| Preferences | Criteria, units, weights, vetoes, stakeholder profiles, and conflict analysis |
| Evidence | Provenance, claims, epistemic classes, verification, correction, and restriction |
| Scenario Planning | Budgeted scenario trees, branches, assumptions, and isolated branch memory |
| Evaluation | Verification, hard constraints, scorecards, Pareto sets, abstention, and briefs |
| Governance | Policy, consent, purpose, retention, risk, approvals, and safety cases |
| Learning | Observed outcomes, calibration, drift, candidates, promotion, and rollback |
| Integrations | Connector registrations, capabilities, qualification, egress, and quarantine |
| Commercial Operations | Entitlements, quotas, reservations, metering, and reconciliation |

For binding design rules, read the [domain design](./docs/ddd/README.md), [context map](./docs/ddd/context-map.md), and [aggregate catalog](./docs/ddd/aggregate-catalog.md).

## Repository structure

```text
src/
  apps/                    API, worker, and web entry points
  <bounded-context>/       Domain, application, contracts, infrastructure
  platform/                Shared persistence, workflows, security, release, telemetry
  shared/                  Stable domain and contract primitives
contracts/                 OpenAPI, AsyncAPI, and JSON Schema contracts
migrations/                Expand-first PostgreSQL migrations
config/                    Kubernetes, security, SLO, and release policy
tests/                     Domain, contract, component, security, platform, and journey tests
benchmarks/                Source-bound performance benchmarks
docs/                      ADRs, domain specifications, evidence, and runbooks
artifacts/evidence/        Generated local source receipts and release evidence
```

## Getting started

### Prerequisites

- Node.js 24 recommended; Node.js 22 is the minimum declared runtime
- npm 11
- Docker or compatible container runtime for PostgreSQL and sandbox checks

### Install

```bash
git clone https://github.com/nicholas-ruest/deliberation.git
cd deliberation
npm ci --ignore-scripts
```

### Build and validate

```bash
npm run build
npm run quality
npm run benchmark
```

`npm run quality` runs compilation, type checking, architecture rules, contract validation, migration safety, security scanning, license policy, deployment checks, prohibited-shortcut controls, tests, and coverage.

### Run locally

Build first, then start each process in a separate terminal:

```bash
npm run start:api
npm run start:worker
npm run start:web
```

Default endpoints:

| Process | Address | Health endpoints |
|---|---|---|
| API | `http://127.0.0.1:3000` in local demo mode | `/health/live`, `/health/ready` |
| Web | `http://127.0.0.1:3001` | `/health/live`, `/health/ready` |
| Worker | Background process | Process lifecycle and dependency readiness |

The header-based domain demo is intentionally disabled in production and binds to loopback only when explicitly enabled:

```bash
ALLOW_LOCAL_DOMAIN_DEMO=true npm run start:api
```

Do not expose this mode to an untrusted network.

## Quality and verification

| Command | Purpose |
|---|---|
| `npm test` | Run the complete Vitest suite |
| `npm run test:coverage` | Run tests and produce V8 coverage |
| `npm run test:architecture` | Enforce module and dependency boundaries |
| `npm run test:contracts` | Verify API, event, persistence, and workflow contracts |
| `npm run test:security` | Run security-focused tests |
| `npm run contracts:validate` | Validate OpenAPI, AsyncAPI, and JSON Schemas |
| `npm run migrations:check` | Reject unsafe migration operations |
| `npm run security:scan` | Scan source for prohibited security patterns |
| `npm run deployment:check` | Validate image and Kubernetes deployment controls |
| `npm run sandbox:test` | Exercise worker container restrictions |
| `npm run benchmark` | Run reproducible local performance benchmarks |
| `npm run evidence:source` | Bind the exact source tree into an evidence receipt |

CI runs the production-quality sequence against PostgreSQL, executes benchmarks and sandbox tests, audits dependencies, generates an SBOM, and uploads source-bound evidence.

## Security model

Security controls are designed to compose rather than depend on a single perimeter:

- Asymmetric identity verification with strict issuer, audience, lifetime, session epoch, and replay checks
- Server-side policy evaluation using tenant, principal, purpose, resource, risk, consent, and obligations
- Context-owned PostgreSQL schemas, runtime roles, row-level security, and optimistic concurrency
- Opaque cell/tenant object partitions with AES-256-GCM authenticated encryption and wrapped data keys
- Default-deny dependency qualification, immutable versions, post-call requalification, and quarantine fencing
- Short-lived audience-bound Kubernetes workload tokens and default-deny network policy
- Read-only, non-root containers with dropped capabilities and explicit resource bounds
- Typed validation at prompts, retrieved content, model output, connector input, and connector output
- Independent build attestation and release authorization with digest-bound evidence
- Content-minimized telemetry and billing dimensions

Please do not report sensitive vulnerabilities in a public issue. Use the repository owner's private security reporting channel when available.

## Data governance

The canonical system of record is PostgreSQL. Search, caches, vector indexes, and projections are rebuildable and never authoritative. Large immutable artifacts are referenced through opaque hashes and encrypted object-store metadata.

Consent withdrawal immediately restricts matching processing. Physical deletion, key destruction, projection removal, backup expiry, learning-cohort exclusion, and lawful exceptions are coordinated through an auditable erasure workflow. Legal holds prevent physical deletion but do not restore access.

## Deployment model

Production is designed as independently operated regional Kubernetes cells. Each cell has explicit tenant placement, workload identities, private data-plane endpoints, queue and workflow dependencies, encryption keys, quotas, telemetry, and a bounded failure budget.

Repository deployment assets include:

- Digest-addressed API, worker, and web images
- Restricted pod security contexts and dedicated service accounts
- Default-deny networking with explicit edge, DNS, and private-dependency paths
- Topology spreading, disruption protection, autoscaling, and resource quotas
- Release policy, evidence requirements, SLOs, and operational runbooks

Infrastructure definitions are release inputs, not permission to deploy. Production promotion requires independent authorization and environment-qualified evidence.

## Production readiness

Passing local CI is necessary but not sufficient for a production claim. The following evidence must be captured in the intended environment:

- Managed Kubernetes admission, network isolation, overload, and failure-domain exercises
- PostgreSQL RLS, failover, point-in-time restore, backup, and no-resurrection tests
- KMS rotation, revocation, key-destruction, and object restore exercises
- Durable workflow crash-boundary, restart, upgrade, cancellation, repair, and broker-outage tests
- OIDC, SAML, SCIM, JWKS rotation, logout, revocation, and workload-identity journeys
- Provider residency, retention, deletion, billing, throttling, credential rotation, and exit drills
- Multi-controller release authorization, canary, signed rollback, rollback-health, and protection-drift tests
- Browser security, automated WCAG 2.2 AA, keyboard, screen-reader, zoom, contrast, reduced-motion, and comprehension reviews

The detailed evidence boundary for ADR-026 through ADR-032 is documented in [prompts-026-032.md](./docs/implementation/prompts-026-032.md).

## Documentation

| Resource | Description |
|---|---|
| [Architecture decisions](./docs/adr/README.md) | Governing technical and product decisions |
| [Domain design](./docs/ddd/README.md) | Strategic model and shared invariants |
| [Context map](./docs/ddd/context-map.md) | Ownership and integration relationships |
| [Aggregate catalog](./docs/ddd/aggregate-catalog.md) | Aggregate roots, commands, and transaction boundaries |
| [Application contracts](./docs/ddd/application-contracts.md) | Command, query, event, idempotency, and error contracts |
| [Authorization and audit](./docs/ddd/authorization-and-audit.md) | Roles, policies, obligations, approvals, and audit |
| [Operational model](./docs/ddd/operational-model.md) | SLOs, incidents, capacity, continuity, and releases |
| [Implementation readiness](./docs/ddd/implementation-readiness.md) | Test pyramid and production acceptance journeys |
| [Prompts 01–18 evidence](./docs/implementation/prompts-01-18.md) | Core platform implementation increments |
| [Prompts 026–032 evidence](./docs/implementation/prompts-026-032.md) | Regional production and web foundations |
| [Runbooks](./docs/runbooks/stuck-workflow.md) | Operational diagnosis and repair procedures |

## Contributing

Changes must preserve bounded-context ownership, public contracts, tenant isolation, human authority, provenance, idempotency, and release evidence.

Before opening a pull request:

```bash
npm ci --ignore-scripts
npm run quality
npm run benchmark
git diff --check
```

Use Conventional Commits:

```text
feat(scope): describe the change
fix(scope): describe the correction
docs(scope): describe the documentation update
```

Do not commit credentials, `.env` files, generated secrets, or provider tokens. Do not add `Co-Authored-By` attribution unless the repository explicitly configures and authorizes it.

## License

This project is licensed under the terms in [LICENSE](./LICENSE).
