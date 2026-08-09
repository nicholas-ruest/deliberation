# ADR-043: Re-Check Artifactless Dependencies (RuLake, RVM) on a Schedule Instead of Once

- **Status**: proposed
- **Date**: 2026-08-09
- **Deciders**:
- **Tags**: supply-chain, integrations, persistence, runtime

## Context

ADR-038 (RuLake) and ADR-040 (RVM) both stopped at the same wall: as of their implementation date,
neither project had ever published a runnable artifact — RuLake has zero GitHub releases, RVM's
releases are source tarballs only. Both ADRs shipped a real contract (`VectorCachePort`,
`SandboxedExecutionPort`) and a working or refusal-only reference adapter, but nothing that checks
whether that's still true. A one-time "no artifact exists" finding, recorded only in an ADR and a
test comment, goes stale silently — six months from now nothing in this repository would notice or
report that RVM shipped a binary, and the interface built to anticipate it would sit unused
indefinitely for a reason that no longer holds.

## Decision

Add one scheduled check, `scripts/check-artifactless-dependencies.ts`, covering both RuLake and
RVM (and any future dependency integrated as scaffolding-only for the same reason) from a small,
explicit registry:

```text
{ id: 'rulake', repo: 'ruvnet/RuLake', requires: 'a GitHub release OR an npm/crates.io package' }
{ id: 'rvm',    repo: 'ruvnet/rvm',    requires: 'a GitHub release with a binary/library asset, or an npm/crates.io package' }
```

The check queries each repository's releases and, where applicable, the npm/crates.io registries
(the same `gh api repos/<owner>/<repo>/releases` and `npm view <package> version` calls used to
establish the original finding), and:

- **exits 0 with a log line** if the artifact situation is unchanged (still nothing to qualify
  against) — this is the expected, ordinary result and must not fail CI;
- **exits non-zero** only when an artifact now exists that did not before, surfacing it as an
  actionable finding ("RuLake published its first release: v0.1.0, containing linux-x64 binary —
  re-evaluate ADR-038") rather than a silent gap.

This runs on the same weekly cadence as Dependabot (ADR-034 item 6) and ADR-042's audit re-check,
not on every PR — it depends on external network state that has no reason to change between
commits, and a flaky external API should not block unrelated work.

A newly available artifact does not auto-integrate. It re-opens the relevant ADR (038 or 040) for
a real qualification pass — version pinning, fixture testing, benchmarking against the existing
reference adapter (mirroring ADR-007's "benchmark both adapters under equivalent workloads before
enabling" requirement) — the same rigor any new dependency gets, just triggered by evidence instead
of a calendar reminder.

## Consequences

### Positive

- Converts "we checked once and wrote it down" into "we keep checking," without manual
  reintroduction of the exact due-diligence effort ADR-038/040 already spent.
- Cheap: this is a read-only check against public registries/release APIs, no different in kind
  from the qualification research already performed for these two dependencies.

### Negative

- Adds a scheduled job with an external network dependency (GitHub/npm/crates.io availability);
  needs to fail soft (log a warning, not block unrelated CI) on a transient outage rather than a
  real negative result.
- A false "nothing changed" if a project renames its repository or moves its release process
  somewhere this check doesn't look — the registry needs occasional manual review, the same
  caveat any external-signal-based automation carries.

### Neutral

- This ADR does not lower the bar for qualifying RuLake or RVM once an artifact exists; it only
  ensures the trigger to re-evaluate is automatic instead of accidental.

## Links

- [ADR-007](./ADR-007-isolate-branch-memory-behind-a-port.md)
- [ADR-031](./ADR-031-qualify-and-contain-external-production-dependencies.md)
- [ADR-034](./ADR-034-close-multi-replica-and-attack-surface-gaps-in-the-wired-runtime.md)
- [ADR-038](./ADR-038-front-vector-reads-with-rulake.md)
- [ADR-040](./ADR-040-run-connector-and-worker-execution-inside-rvm.md)
- [ADR-041](./ADR-041-hold-supply-chain-blocked-dependencies-at-qualifying-not-eligible.md)
