# ADR-034: Close Multi-Replica and Attack-Surface Gaps in the Wired Runtime

- **Status**: proposed
- **Date**: 2026-08-08
- **Deciders**:
- **Tags**: security, runtime, observability, supply-chain

## Context

ADR-033 wired persistence, identity verification, and telemetry into the entrypoints that actually
serve traffic, and validated the result end to end against a real PostgreSQL instance. That
validation, plus a follow-up review of the wired code against how it actually runs in
`config/kubernetes/api-deployment.yaml` (3 replicas behind a load balancer), found seven further
gaps. All seven are within this repository's own control — none require an adopter to connect
anything they haven't already connected for ADR-033. In order of how much they matter:

1. **`TrustedIdentityVerifier`'s replay protection does not survive more than one replica.**
   `MemoryReplayStore` (`src/platform/security/trusted-identity.ts`) keeps consumed token IDs in
   one process's memory. `api-deployment.yaml` runs 3 replicas behind a load balancer with no
   session affinity requirement. A token replayed against a different pod than the one that first
   saw it is not caught — that pod's in-memory store has never seen the `jti`. This directly
   undercuts the replay test ADR-033 added (`tests/security/api-auth-bypass.test.ts`), which only
   proves replay protection within a single process.
2. **The request schema bounds nothing on the high side.** `LaboratoryInputSchema` in
   `src/apps/api.ts` uses `.min(1)` on `criteria`, `findings`, `scores`, and similar arrays, with
   no `.max()`. Inside the existing 1MB body cap, a client can still pack in thousands of small
   array entries and drive `DecisionLaboratory.run()`'s per-item loops far past any legitimate
   input shape — a cheap algorithmic-complexity denial of service that the size cap alone does not
   stop.
3. **Nothing rate-limits the authenticated endpoint.** Once a client clears identity verification,
   `POST /v1/laboratory/runs` accepts requests as fast as they arrive. There is no per-tenant or
   per-principal ceiling at all.
4. **Auth failures are invisible to telemetry.** `handleVerifiedRun` returns 401/403 on every
   rejection path without ever calling `telemetry.operation()` or emitting a metric. A burst of
   forged, expired, or replayed tokens produces no signal anywhere an operator would look.
5. **`security:scan` is a fixed regex linter, not SAST or CVE scanning.** It catches the patterns
   its rules name (`eval`, hardcoded secrets, interpolated SQL) and nothing else. `npm audit`
   covers JavaScript dependencies but never inspects what actually ends up in the built Alpine
   container images.
6. **Nothing updates pinned versions.** Base images, GitHub Actions, and npm dependencies are all
   pinned to exact versions or digests — good for reproducibility, but nothing bumps a pin when a
   CVE lands upstream. A fix landing in an upstream package is invisible until a human happens to
   re-run an audit.
7. **Verifier rejection responses leak the specific denial reason.** `handleVerifiedRun` forwards
   `identity.error.message` — `"Invalid token signature"`, `"Untrusted issuer or audience"`,
   `"Replayed identity token"`, and so on — straight into the HTTP response body. That is useful
   for the test suite and legitimate debugging, but it also hands an attacker a free oracle for
   iterating on a forged token: each response says exactly which check to fix next.

## Decision

Fix each gap in the code this repository ships, with no new adopter-facing configuration beyond
what ADR-033 already requires (Postgres, a trusted issuer). Where a fix trades off debuggability or
introduces a new internal dependency, that tradeoff is named explicitly rather than left implicit.

1. **Replace the in-memory replay store with a Postgres-backed one by default.** Add
   `identity_access.consumed_identity_tokens` (migration 0005): a single `INSERT ... ON CONFLICT
   (token_key) DO NOTHING RETURNING token_key` makes first-use detection atomic and correct across
   any number of replicas, using Postgres's own unique-constraint enforcement rather than
   apphttp-level locking. `TrustedIdentityVerifier.verify()` becomes asynchronous to support this
   (`ReplayStore.consume` returns `Promise<boolean>`); `MemoryReplayStore` remains available for
   tests and the single-process demo path, where it is still accurate. Connects through the same
   `SET LOCAL ROLE` least-privilege pattern ADR-033 established, scoped to the existing
   `deliberation_identity_access_runtime` role — no new role is needed since replay tracking
   belongs to the identity-and-access context. Stale rows are opportunistically swept rather than
   requiring a new scheduled job.
2. **Add upper bounds to every unbounded array and enum-adjacent string field in
   `LaboratoryInputSchema`.** Caps are sized generously above any realistic legitimate request
   (see acceptance evidence) so no real caller is affected, while an attacker can no longer turn a
   1MB body into an unbounded number of loop iterations.
3. **Add a Postgres-backed fixed-window rate limiter, applied per `(tenant_id, principal_id)`
   after identity verification.** A single atomic upsert per request
   (`identity_access.rate_limit_counters`, keyed by `(bucket_key, window_start)`) increments a
   per-minute counter and rejects with `429` once a configurable ceiling
   (`RATE_LIMIT_PER_PRINCIPAL_PER_MINUTE`, sanely defaulted) is exceeded — correct across replicas
   for the same reason item 1 is. This deliberately does not attempt to rate-limit
   *unauthenticated* traffic by IP: that is edge/load-balancer territory (ADR-029's trusted API
   edge), and doing it well requires trusting an `X-Forwarded-For` boundary this repository does
   not control. Authenticated-endpoint flooding by a credentialed principal is the gap that is
   ours to close; edge-level protection against anonymous flooding is not.
4. **Give every identity-verification rejection a stable, low-cardinality `reasonCode`** (in
   `DomainError.details`, not the free-text `message`) and emit it through a new
   `Telemetry.recordRejection()` counter at every 401/403 path in `handleVerifiedRun`, alongside
   the existing rate-limit rejections from item 3. This makes an attack attempt visible in metrics
   even though (per item 7) it is no longer visible in the HTTP response.
5. **Add CodeQL static analysis and container image scanning (Trivy or Grype) to CI.** Both are
   free for this project's visibility, require no adopter dependency, and cover ground
   `security:scan`'s regex rules and `npm audit` do not: real dataflow analysis, and OS-package
   CVEs baked into the shipped Alpine images rather than only the JS dependency tree.
6. **Add a Dependabot (or Renovate) configuration** covering npm dependencies, the three
   Dockerfiles' base images, and GitHub Actions, so a CVE patched upstream produces a PR instead of
   silent staleness. This does not auto-merge anything — it surfaces the update for the same
   `npm run quality` gate every other change goes through.
7. **Stop forwarding the verifier's rejection message to the client.** External responses for a
   failed identity check carry the existing `code` (`PERMISSION_DENIED`) and nothing else; the
   detailed reason is available server-side through the item-4 telemetry and via a correlation-ID-
   keyed server log line, for an operator who needs to debug a legitimate integration failure. This
   is a deliberate debuggability-for-opacity tradeoff: a legitimate adopter integrating against
   this API now has to correlate a support request by correlation ID instead of reading the reason
   off the response; an attacker probing the boundary no longer gets a free oracle.

## Consequences

### Positive

- Replay protection, and the new rate limiter, are correct under the exact replica topology this
  repository already ships in `config/kubernetes/api-deployment.yaml`, closing a gap between the
  security property ADR-033 tested and the property that topology actually provides.
- An attack attempt against the identity boundary now produces both a metric (item 4) and, going
  forward, a scanner finding if it exploits a known CVE class (item 5) or a stale dependency
  (item 6) — all without any adopter action.
- Removing detailed rejection reasons from responses (item 7) closes a real, if narrow,
  reconnaissance channel.

### Negative

- `TrustedIdentityVerifier.verify()` becoming asynchronous is a breaking change to its two current
  call sites (`src/apps/api.ts`, `tests/platform/prompts-026-032.test.ts`) and to
  `tests/security/api-auth-bypass.test.ts`'s assertions on response `detail` text, all of which
  this ADR's implementation must update in the same change.
- Every identity check and every authenticated request now costs an additional Postgres round
  trip (replay check, rate-limit upsert) beyond what ADR-033 already added. This is an accepted
  latency/throughput tradeoff for correctness under replication; no load test yet quantifies it.
- Item 7 makes legitimate integration debugging strictly harder from the client side — a developer
  integrating against this API has to ask an operator to look up a correlation ID instead of
  reading the reason directly off the response.
- CodeQL and image-scan findings (item 5) and Dependabot PRs (item 6) are new ongoing maintenance
  load: someone has to triage them, or they become noise nobody reads.

### Neutral

- None of these changes touch what remains explicitly out of this repository's control: the
  adopter still supplies their own Postgres, identity provider, and OTel collector, unchanged from
  ADR-033. Edge-level (pre-authentication) rate limiting and WAF-class protections remain
  adopter/ADR-029 territory, named explicitly in item 3 rather than silently assumed.

## Links

- [ADR-029](./ADR-029-establish-a-trusted-api-edge-and-workload-identity.md)
- [ADR-033](./ADR-033-wire-built-capabilities-into-the-runtime-path-with-fail-closed-defaults.md)
- [Prompt 033 evidence](../implementation/prompt-033.md)
