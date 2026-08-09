# ADR-047: Add Load, Soak, and Chaos Testing

- **Status**: proposed
- **Date**: 2026-08-09
- **Deciders**:
- **Tags**: performance, reliability, testing

## Context

`benchmarks/` (`branch-memory.bench.ts`, `prompt-026-032.bench.ts`) measures in-process function
call latency — cell-placement checks, dependency-decision evaluation, branch-memory forking. These
are real, useful microbenchmarks, and they are the only performance evidence this repository has.
Nothing exercises the system the way production traffic would: concurrent requests against a
running `api.ts`, sustained load over time, or the failure modes ADR-015/ADR-022 already design
for (overload, cell failure, dependency outage) but have never been proven to actually survive.

ADR-018's own required test pyramid explicitly names "performance, soak, chaos" tests as required
evidence for a production release claim — this is a named, existing gap against this repository's
own definition of done, not a new standard being introduced by this ADR.

## Decision

Three test classes, each with a distinct purpose, tool, and place to run — none of them belong in
the fast per-PR `npm run quality` gate:

1. **Load testing**: concurrent HTTP traffic against a real running `api.ts` (the same
   `startApi`/real-process pattern `tests/security/api-process-harness.ts` already established,
   extended to many concurrent clients rather than one at a time), measuring the SLOs
   `config/operations/slos.json` already declares (`command-api` availability/latency,
   `authorization` p99Ms) under realistic concurrency — including the rate limiter (ADR-034) and
   replay store (ADR-034) under real concurrent load, not just the sequential test-by-test
   exercise they got in `tests/security/`.
2. **Soak testing**: the same load sustained for an extended duration (hours, not seconds) to
   surface what short tests structurally cannot — connection pool exhaustion, memory growth,
   the outbox worker's poll loop under continuous production, replay-store/rate-limiter table
   growth (both do opportunistic, probabilistic cleanup — ADR-034 — soak testing is what proves
   that cleanup keeps pace rather than accumulating unbounded rows).
3. **Chaos testing**: deliberate failure injection during load — kill a worker pod mid-relay,
   drop the Postgres connection, expire a token mid-request — verifying the system fails the way
   ADR-022 (cell-based failure isolation) and ADR-004 (durable workflow/outbox) claim it does,
   rather than assuming their unit/component tests generalize to a running system under stress.

All three run against real infrastructure (the same local Postgres pattern already used
throughout this repository's component/security tests), in a separate, longer-running CI job or
scheduled workflow — not blocking every PR, mirroring how `sandbox:test` and `benchmark` already
run in CI but load/soak/chaos runs on a slower cadence given their duration. Pass/fail criteria are
the SLOs already declared in `config/operations/slos.json`, not new numbers invented for this ADR
— this closes part of the gap ADR-048 separately identifies (those SLOs currently have nothing
evaluating them, in production or in test).

## Consequences

### Positive

- Produces the first real evidence that this platform survives concurrent, sustained, or
  adverse-condition traffic — currently a completely untested dimension.
- Directly exercises the multi-replica correctness properties ADR-034 added (replay store, rate
  limiter) under the concurrency they were specifically built for, closing the gap between "proven
  correct with two sequential requests" and "proven correct under load."

### Negative

- Meaningfully more expensive to build and run than the existing microbenchmarks — needs its own
  tooling choice (a load-generation library, or hand-rolled concurrent request fan-out), its own
  CI time budget, and its own maintenance as the platform's endpoints evolve.
- Chaos testing in particular requires care not to leave test infrastructure in a broken state
  (a genuinely killed worker process, a genuinely dropped connection) — needs reliable teardown,
  or it becomes a source of CI flakiness rather than a source of confidence.

### Neutral

- This ADR does not propose new SLO targets; it proposes finally testing against the ones
  `config/operations/slos.json` already declares.

## Links

- [ADR-004](./ADR-004-use-transactional-outbox-and-durable-workflows.md)
- [ADR-015](./ADR-015-operate-with-slos-open-telemetry-and-disaster-recovery.md)
- [ADR-018](./ADR-018-require-evidence-based-release-quality-gates.md)
- [ADR-022](./ADR-022-use-cell-based-failure-isolation-and-admission-control.md)
- [ADR-034](./ADR-034-close-multi-replica-and-attack-surface-gaps-in-the-wired-runtime.md)
- [ADR-048](./ADR-048-evaluate-slos-and-alerts-at-runtime.md)
