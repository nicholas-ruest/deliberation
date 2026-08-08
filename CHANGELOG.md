# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Tagged release workflow (`.github/workflows/release.yml`) that runs the same quality gate as a pull request, then builds, pushes, and keyless-signs the API, web, and worker container images with a CycloneDX SBOM attestation.
- Reusable quality-gate workflow (`.github/workflows/quality.yml`) shared by the pull-request and release pipelines.
- `npm run version:check`, enforcing that `package.json` carries a valid semantic version and that a release tag agrees with both that version and this changelog.
- This changelog.

## [0.1.0] - 2026-07-31

Initial public source release. The pipeline that publishes signed release artifacts is introduced in `[Unreleased]`; no version of this project has been published to a registry yet.

### Added

- MIT-licensed repository skeleton and project README.
- Architecture decision records ADR-001 through ADR-032, covering the human-authority decision laboratory framing, the domain-aligned modular monolith, PostgreSQL as the canonical system of record, transactional outbox and durable workflows, tenant isolation and zero-trust authorization, supply-chain security, evidence-based release gates, regional Kubernetes cells, managed data plane and workflow fabric, trusted API edge and workload identity, and external dependency qualification.
- Domain-driven design documentation: strategic model, context map, aggregate catalog, application contracts, authorization and audit model, operational model, and implementation readiness.
- TypeScript source skeleton for ten bounded contexts, each with its own domain, application, and infrastructure layers, plus independently runnable `api`, `worker`, and `web` entrypoints.
- Platform modules for persistence, durable workflows, security and trusted identity, model gateway, release authority, cell placement, and telemetry.
- Contract-first API and event definitions: OpenAPI v1, AsyncAPI v1, and JSON Schemas for command, query, integration-event, operation, problem-details, and webhook-delivery envelopes.
- Repository quality gates: build, typecheck, architecture and dependency-boundary checks, contract validation, migration safety checks, security scanning, license checking, deployment validation, prohibited-shortcut controls, coverage, and benchmarks, wired into a `quality` npm script.
- Continuous integration workflow running the quality sequence against a PostgreSQL service container, plus benchmarks, a container sandbox test, `npm audit`, SBOM generation, and a source-bound evidence receipt.
- Container images for the API, worker, and web processes, built from digest-pinned base images as non-root multi-stage builds.
- Kubernetes deployment manifests, cell foundation resources, network and workload security policies, and operational configuration for SLOs, alerts, and release policy.

[Unreleased]: https://github.com/nicholas-ruest/deliberation/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/nicholas-ruest/deliberation/releases/tag/v0.1.0
