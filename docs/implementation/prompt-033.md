# Prompt 033 implementation evidence

This increment implements ADR-033: wiring already-built persistence, identity-verification, and
observability code into the entrypoints that actually serve traffic, with fail-closed defaults
when an adopter has not yet configured their own infrastructure. It does not stand up or operate
any adopter's Postgres, identity provider, OTel collector, or Kubernetes cluster — those remain
adopter-owned per ADR-011/015/026/027/031, unchanged by this increment.

## What changed

1. **Persistence wiring** — `src/apps/api.ts`'s `/v1/laboratory/runs` handler now writes through
   `PostgresUnitOfWork`/`PostgresAggregateStore` inside a real tenant-scoped transaction instead
   of running in-memory only. The demo/no-database path requires two independent, affirmative
   conditions (`ALLOW_LOCAL_DOMAIN_DEMO=true` **and** `NODE_ENV` explicitly `development`/`test`)
   instead of one flag pair; an unset `NODE_ENV` no longer defaults to demo-allowed, and
   `NODE_ENV=production` always disables the demo path regardless of the flag.
2. **Identity verification wiring** — the handler now requires a signed bearer token verified by
   `TrustedIdentityVerifier` (Ed25519, replay-checked) instead of trusting client-supplied
   `x-tenant-id`/`x-principal-id` headers. A non-demo process refuses to start at all without
   `IDENTITY_TRUSTED_ISSUERS` configured.
3. **Least-privilege RLS binding** — `PostgresUnitOfWork.inTenantTransaction` gained an optional
   `runtimeRole` parameter that issues `SET LOCAL ROLE` before use. This was a real gap found
   during manual validation of this increment: a superuser connection (the shape `DATABASE_URL`
   commonly takes in CI/dev) bypasses row-level security entirely regardless of
   `FORCE ROW LEVEL SECURITY`, so wiring persistence without also wiring the role downgrade would
   have shipped an endpoint that looked tenant-isolated but was not. `migrations/0004` adds a
   `deliberation_laboratory_runtime` role scoped to exactly the three schemas the laboratory
   composition root touches (`deliberation`, `scenario_planning`, `evaluation`); `api.ts` and
   `worker.ts` both now pass a role into every transaction.
4. **Worker wiring** — `src/apps/worker.ts` replaced its no-op sleep loop with a real
   Postgres-backed outbox consumer (`SELECT ... FOR UPDATE SKIP LOCKED`, tenant-scoped, per
   configured `WORKER_TENANT_IDS`) and gained real `/health/live`/`/health/ready` endpoints whose
   readiness reflects an actual poll-completion watermark, not process-alive-only.
5. **Observability wiring** — `src/platform/observability/otel-bootstrap.ts` registers a real
   OTel `NodeTracerProvider`/`MeterProvider` when `OTEL_EXPORTER_OTLP_ENDPOINT` or
   `OTEL_CONSOLE_EXPORTER=true` is set, and both entrypoints call the existing `Telemetry` helpers
   on their real request/job paths. Left unconfigured, nothing is registered and the OTel API's
   built-in no-op providers remain in place — call sites are safe either way.
6. **Secrets** — `src/platform/security/secret-provider.ts` adds `SecretProvider`, enumerating
   required configuration at startup and refusing to start with a named error if missing, with a
   `${NAME}_FILE` convention for mounted-secret volumes alongside direct env vars.
7. **Deployment starting points** — a Kustomize base plus dev/staging/prod example overlays under
   `config/kustomize/` give adopters a documented multi-environment starting point without
   fabricating cluster/image-digest values; `scripts/check-deployment.ts` validates overlays the
   same way it already validated the base manifests.
8. **Release engineering** — a tag-triggered `release.yml` workflow builds, SBOMs, and
   keylessly signs (cosign + GitHub OIDC) container images to this repository's own GHCR, gated on
   the same `npm run quality` check as any PR; `CHANGELOG.md` establishes Keep a Changelog
   tracking going forward.
9. **Test breadth** — `tests/security/` gained tests exercising the wired auth-bypass, replay,
   RLS-escape, and cross-context-containment behavior against a real Postgres and a real spawned
   `api.ts` process, in the same real-infrastructure style as `tests/component/postgres-rls.test.ts`.

## Local evidence

- `npm run build`
- `npm run typecheck`
- `npm run architecture:check`
- `npm run contracts:validate`
- `npm run migrations:check`
- `npm run security:scan`
- `npm run licenses:check`
- `npm run deployment:check`
- `npm run shortcuts:check`
- `npm run test:coverage`
- `npm run benchmark`

All of the above were run against a real local PostgreSQL instance (migrations 0001-0004
applied) during this increment, including a manual end-to-end validation pass: a spawned
`api.ts` process rejected unauthenticated/forged/expired/replayed requests, accepted a correctly
signed request, persisted it, and a spawned `worker.ts` process relayed the resulting outbox
event — with direct `psql` verification that a different tenant (and an unset tenant) see zero
rows, and that the least-privilege role cannot read outside its three granted schemas.

## External release gates

Unchanged from `docs/implementation/prompts-026-032.md` and still not converted to local
assertions by this increment: managed-cluster enforcement, provider qualification, live
failover/PITR/KMS-rotation exercises, OIDC/SAML/SCIM identity-provider federation journeys
(this increment wires the verifier; it does not stand up or federate with any real IdP),
an actually-executed release publish (the `release.yml` workflow has not been run against a
real tag), and assisted accessibility review.
