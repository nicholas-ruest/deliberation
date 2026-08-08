# ADR-033: Wire Built Capabilities Into the Runtime Path With Fail-Closed Defaults

- **Status**: proposed
- **Date**: 2026-08-08
- **Deciders**:
- **Tags**: runtime, security, observability, self-hosted, supply-chain

## Context

An implementation audit of `src/apps/api.ts`, `src/apps/worker.ts`, `src/platform/security/trusted-identity.ts`, `src/platform/persistence/postgres.ts`, and `src/platform/observability/telemetry.ts` found a recurring pattern: the hard part is already built and unit-tested, but the shipped entrypoints do not call it.

- `api.ts` never imports `postgres.ts`. Its only real route (`POST /v1/laboratory/runs`) runs entirely in-memory and returns `503 PRODUCTION_INTEGRATIONS_UNCONFIGURED` unless `ALLOW_LOCAL_DOMAIN_DEMO=true` and `NODE_ENV !== 'production'` both hold — one flag pair gates the only defense against serving unconfigured.
- In that same demo path, the handler trusts client-supplied `x-tenant-id`/`x-principal-id` headers outright. `TrustedIdentityVerifier` (Ed25519 signature verification, replay prevention, claim checks) exists, is correct, and is exercised only by its own unit test — no request path calls it.
- `worker.ts` is a five-line `AbortController` sleep loop. It reports as running under any process supervisor while performing no work, against a platform whose ADRs (004, 006, 028) assume durable, queue-driven workers.
- `telemetry.ts` implements spans, counters, histograms, and SLO evaluation against the OpenTelemetry API, but is imported by nothing, and no `TracerProvider`/`MeterProvider`/exporter is registered anywhere. Instrumented or not, none of it emits.
- CI (`.github/workflows/ci.yml`) runs build, typecheck, architecture/contract/migration checks, `security:scan`, `npm audit`, tests, and benchmarks, then stops. There is no publish stage, no signed artifact, no CHANGELOG, and `package.json` has stayed at `0.1.0` with no git tags.
- `tests/component/postgres-rls.test.ts` — the one test that would catch a tenant-isolation regression against a real database — is skipped by default because CI provides no `TEST_DATABASE_URL`.

This project is open source and self-hosted: it does not operate Postgres, an identity provider, a KMS, or a Kubernetes cluster on anyone's behalf. Federated auth (ADR-011), managed data plane (ADR-027), durable workflow fabric (ADR-028), and regional cells (ADR-026) are correctly scoped in prior ADRs as adopter-supplied infrastructure, qualified at the adopter's own release gate. That scoping is not the problem here.

The problem is narrower and fully within this repository's control: when an adopter has *not yet* connected their infrastructure, the code should be unable to masquerade as connected. Right now it can. A deployer who forgets to set an identity provider gets a server that accepts forged identity headers instead of one that refuses to start. A deployer who forgets to configure a queue gets a worker that reports healthy while silently doing nothing, instead of one that fails its readiness probe. That gap — implemented capability, unreached by the paths that decide what a request or job actually does — is what this ADR closes.

## Decision

Adopt one governing rule and apply it to each gap above: **an entrypoint must fail closed — refuse to start, or refuse to serve — whenever a capability it depends on is not explicitly configured, rather than silently degrading, no-oping, or accepting unauthenticated input.** "Not configured" must never be observably indistinguishable from "configured and working." Everything below is something this repository ships and controls; where an item depends on adopter-owned infrastructure (their database, their IdP, their cluster), that boundary is named explicitly and left alone.

1. **Persistence is mandatory, not a header check.** Route `api.ts`'s business handlers through `inTenantTransaction` against an adopter-supplied `DATABASE_URL`. The process refuses to start — not to answer individual requests — when `DATABASE_URL` is unset, in every mode except an explicit demo mode. That demo mode gets two independent guards instead of one flag pair: it binds loopback-only regardless of `ALLOW_LOCAL_DOMAIN_DEMO`, and it is hard-disabled whenever `NODE_ENV=production`, so no single misconfigured variable can expose it.

2. **Identity verification runs on every request, unconditionally.** Make `TrustedIdentityVerifier` mandatory middleware in front of the business route; delete the code path that trusts `x-tenant-id`/`x-principal-id` headers directly. Production mode cannot construct a server without a configured verifier (issuer key, audience, claim policy). The verifier's key material is adopter-supplied — their issuer, their JWKS, their workload identity — and stays out of scope here; the code path that calls it on every request and rejects on missing or invalid signatures is what we ship.

3. **The worker consumes real work by default.** Replace the sleep loop with a consumer over the `outbox`/workflow tables the migrations already define. Postgres is already this project's one hard, self-hostable dependency, so a working reference consumer ships without requiring adopters to stand up a managed queue first (ADR-028's managed fabric remains the upgrade path, still an adopter release gate). Liveness/readiness reflect actual consumption progress — a claim watermark, not "process is alive."

4. **Telemetry is registered, not just importable.** Register an OTel `TracerProvider`/`MeterProvider` at process start in every entrypoint, with an exporter endpoint read from adopter configuration and a safe no-op/console default when unset. Call the existing span/counter/histogram helpers from the real request and job paths added in (1) and (3). We ship the wiring and the safe default; the adopter's collector or backend is theirs to point it at.

5. **Secrets are enumerated and checked at startup, not read ad hoc.** Introduce a narrow `SecretProvider` port with an env/file-backed reference adapter. On startup, enumerate the secrets required by whatever features are configured and refuse to start with a specific, named error when any are missing, instead of proceeding with `undefined` and failing later, obscurely. We do not ship or operate a secrets manager; we ship the seam and the refusal to run without it.

6. **Deployment artifacts are verifiable, not build-from-source-only.** Keep `check-deployment.ts` failing loudly on unresolved placeholders (`RELEASE_DIGEST_REQUIRED`, `CELL_ID_REQUIRED`). Add a CI publish stage on tagged release that builds, generates an SBOM for, and signs (cosign keyless via GitHub OIDC) container images to a public registry, so adopters can verify what they deploy instead of trusting an unsigned build. Ship a minimal Kustomize base with named example overlays (dev/staging/prod) so the current single generic template becomes a documented starting point. Actual cluster provisioning and regional cell placement remain adopter-owned, per ADR-026.

7. **Releases are versioned, not frozen.** Enforce semantic versioning in CI, generate a CHANGELOG from conventional commits, and tag releases so `0.1.0` stops standing in for every change since the initial commit. `release-evidence.ts`'s local qualification receipt becomes one input bound into the signed release bundle from (6), not a substitute for it.

8. **The tests that would catch a regression here actually run.** Run `tests/component/postgres-rls.test.ts` against a real ephemeral Postgres service container in CI instead of skipping it by default. Add auth-bypass, RLS-escape, and injection tests under `tests/security/` that specifically target the paths wired in (1) and (2), so the fail-closed behavior this ADR requires is enforced by a gate, not just by review.

## Consequences

### Positive

- Closes the specific gap where "enterprise capability exists in the codebase" and "enterprise capability protects a live request" were different claims; after this ADR, an unconfigured deployment is loud and unusable rather than quietly insecure.
- Self-hosters get a working default (Postgres-backed worker, wired auth, wired telemetry) without first standing up managed infrastructure, while the upgrade path to managed providers (ADR-026–031) is unchanged.
- Signed, versioned release artifacts give adopters something to verify and pin to, independent of how they provision their own environment.

### Negative

- Local development gets stricter: contributors need a running Postgres and a configured (even if self-signed/dev) identity issuer to run anything beyond the guarded demo mode, raising the setup bar versus today's header-trusting shortcut.
- The demo mode's two independent guards add a small amount of permanent branching complexity to `api.ts` that a single flag did not have.
- CI runtime increases (ephemeral Postgres service container, signing step), and release cutting now requires the semantic-versioning/CHANGELOG discipline this repository has not exercised yet.

### Neutral

- This ADR does not add, qualify, or promise any managed integration (IdP, KMS, queue fabric, cluster). It only governs what already-approved, adopter-supplied integration points do when nothing has been connected yet.
- The Kustomize base and example overlays are a starting point for adopters, not a hosted deployment; ADR-026's regional-cell scope is unchanged.

## Links

- [ADR-004](./ADR-004-use-transactional-outbox-and-durable-workflows.md)
- [ADR-006](./ADR-006-use-budgeted-central-orchestration-and-isolated-workers.md)
- [ADR-011](./ADR-011-enforce-tenant-isolation-and-zero-trust-authorization.md)
- [ADR-015](./ADR-015-operate-with-slos-open-telemetry-and-disaster-recovery.md)
- [ADR-017](./ADR-017-secure-the-software-and-ai-supply-chain.md)
- [ADR-018](./ADR-018-require-evidence-based-release-quality-gates.md)
- [ADR-020](./ADR-020-treat-deployment-configuration-and-secrets-as-versioned-products.md)
- [ADR-026](./ADR-026-run-production-as-regional-kubernetes-cells.md)
- [ADR-028](./ADR-028-use-a-managed-durable-workflow-and-queue-fabric.md)
- [ADR-031](./ADR-031-qualify-and-contain-external-production-dependencies.md)
