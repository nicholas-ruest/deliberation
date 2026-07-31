# deliberation
# Deliberation Platform

An evidence-grounded, human-authority decision laboratory implemented as a TypeScript domain-aligned modular monolith.

## Local development

Requirements:

- Node.js 24
- npm 11
- Docker for PostgreSQL/container component tests

```bash
npm ci --ignore-scripts
npm run quality
npm run build
npm run benchmark
```

Run the processes:

```bash
npm run start:api
npm run start:worker
```

The API exposes `/health/live` and `/health/ready`. Business application services are consumed through context public APIs under `src/<context>`.

## Architecture

The ten bounded contexts own their domains, contracts, application services, and infrastructure adapters. Public context roots never expose infrastructure. Cross-context coordination uses published contracts/events and durable workflows.

- [Architecture decisions](./docs/adr/README.md)
- [Domain design](./docs/ddd/README.md)
- [Dependency rules](./docs/architecture/dependency-rules.md)
- [Implementation evidence](./docs/implementation/prompts-01-18.md)
- [Prompts 026–032 implementation evidence](./docs/implementation/prompts-026-032.md)
- [Operational model](./docs/ddd/operational-model.md)
- [Runbooks](./docs/runbooks/stuck-workflow.md)

## Security and data

- Commands are tenant/purpose/identity scoped and use typed errors and idempotency keys.
- PostgreSQL schemas are context owned; runtime roles and row-level security enforce tenant scope.
- Large artifacts use opaque hash references and authenticated encryption.
- Untrusted model/connector boundaries validate schemas before state changes.
- Consequential connector writes require policy obligations and human approval.
- Audit records are tenant-partitioned and hash chained.
- Erasure cannot report completion until all registered storage surfaces respond.

Local emulators and deterministic fake providers validate contracts. They do not establish managed-cloud RPO/RTO, external provider residency, production signing identity, or longitudinal SLO compliance.
