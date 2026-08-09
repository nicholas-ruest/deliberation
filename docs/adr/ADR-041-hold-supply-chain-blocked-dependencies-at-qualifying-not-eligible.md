# ADR-041: Hold Supply-Chain-Blocked Dependencies at `qualifying`, Never Silently Ship or Silently Block

- **Status**: proposed
- **Date**: 2026-08-09
- **Deciders**:
- **Tags**: supply-chain, integrations, dependency-qualification

## Context

Implementing ADR-035 (AgentDB) and ADR-036 (agentic-flow) surfaced two concrete, unplanned
findings during integration, not during a later audit:

1. **`npm audit`**: adding `agentdb` and `agentic-flow` pulled in `@huggingface/transformers`
   (`onnxruntime-node`, `sharp`/libvips) and a duplicated OpenTelemetry tree distinct from this
   platform's own — 8 HIGH-severity and 22 moderate findings, none resolvable via `npm audit fix`
   without a breaking downgrade (`agentdb@1.6.1`, `agentic-flow@1.10.2` — materially different,
   unverified APIs from the versions ADR-035/036 actually specify and test against).
2. **`licenses:check`**: `agentic-flow`'s transitive `fastmcp → mcp-proxy → pipenet` chain — an
   internet-tunneling tool, unrelated to the `agentic-flow/router/cost-optimal` subpath this
   platform actually imports, but installed regardless because npm does not prune unused exports
   — shipped no `license` field in its `package.json`, failing `scripts/check-licenses.ts` outright.

Neither finding was a reason invented after the fact to justify caution; both were reproducible,
automated gate failures (`npm audit`, `licenses:check`) encountered while doing the work. Three
responses were available: silently accept the risk and ship anyway (the gate is already scriptable
around); treat either finding as a hard blocker and abandon the ADR-035/036 integrations entirely;
or use the qualification mechanism ADR-031 already built for exactly this situation. This ADR
records the decision to always take the third path, and treats it as a standing rule for any future
dependency this repository integrates — not a one-off judgment call specific to AgentDB and
agentic-flow.

## Decision

A dependency with a real, automated-gate-confirmed finding against it (a CVE with no non-breaking
fix, a denied/undeclared license, or any other `npm run quality` failure traceable to that specific
package) is integrated in full — port, adapter, tests — but its `ProductionDependency` qualification
record is constructed and, at most, moved to `qualifying`. It is never advanced to `eligible` while
the finding stands. Concretely:

1. **The code ships; the authorization does not.** `VersionedDependencyCatalog.authorize()` (ADR-031)
   denies every use of a dependency whose qualification never reached `eligible`, exactly as it
   denies a completely unqualified one. `ModelGateway`'s `denyUnqualifiedModelDependencies` and the
   Evidence context's equivalent default therefore refuse to route to AgentDB or agentic-flow with
   no additional code required — the refusal is the existing default, not a new check bolted on.
2. **The finding is recorded next to the code it blocks, not only in a changelog.** Each blocked
   dependency's qualification-construction site names the exact finding (advisory chain, or license
   + verification trail) and a concrete unblock condition, so the block is falsifiable — a later
   contributor can tell whether the condition still holds without re-deriving it from a git log.
3. **A license finding gets verified before it becomes an exception, never rubber-stamped.** An
   undeclared license is not automatically treated as a denial. It is checked against the package's
   own committed license file or upstream repository metadata; only a positively verified,
   non-denied license may be added as a narrow, named exception (see
   `scripts/check-licenses.ts`'s `missingLicenseExceptions`). An unverifiable or actually-GPL/AGPL
   package gets no exception — it becomes a `missing`/`violations` failure like any other.
4. **Integration is not blocked by a downstream qualification failure.** ADR-035 and ADR-036 were
   still implemented, tested, and merged. Refusing to write the adapter until the CVE chain clears
   would have meant no `EvidenceSearchPort` implementation and no cost-aware model routing exist to
   qualify once it does clear — the port, the adapter, and the qualification record are the
   deliverable; production authorization is a separate, later gate, per ADR-031's own design.
5. **The exit path costs nothing.** Because nothing depends on these dependencies being eligible
   (the default is refusal), removing an integration that never clears qualification is deleting an
   unused code path, not unwinding a production dependency — the same "exit plan" property ADR-031
   already requires of every `DependencyQualification` record.

## Consequences

### Positive

- A real, discovered risk is visible in the code and in `docs/implementation/prompt-035-040.md`
  rather than either hidden in a shipped dependency tree or used as a reason to discard working,
  tested integration code.
- The rule is mechanical, not a judgment call repeated per dependency: any future package that
  fails `npm audit` or `licenses:check` gets the same treatment automatically, by the same
  `ProductionDependency` state machine already governing every other dependency in this platform.
- Costs nothing to reverse: qualification is additive (moving to `eligible` later), never a
  retrofit.

### Negative

- A dependency can sit at `qualifying` indefinitely if upstream never patches the finding, which
  is a real, unresolved product limitation (no cost-aware routing or evidence vector search in
  production) for as long as it lasts — this ADR does not shorten that, only makes it honest.
- Verifying an undeclared license by hand (item 3) is manual work that does not scale to a large
  number of exceptions; if this pattern recurs often, it is a signal to reconsider the dependency,
  not to automate the exception process without review.
- Two real, different dependencies (AgentDB, agentic-flow) share one root cause
  (`@huggingface/transformers`'s transitive tree) — fixing one upstream advisory likely does not
  clear both; each needs its own re-verification before either reaches `eligible`.

### Neutral

- This ADR does not change ADR-031's qualification mechanism itself; it states a policy for when
  to use it — specifically, always, for a dependency with any standing automated-gate finding
  against it, rather than case-by-case.

## Links

- [ADR-017](./ADR-017-secure-the-software-and-ai-supply-chain.md)
- [ADR-018](./ADR-018-require-evidence-based-release-quality-gates.md)
- [ADR-031](./ADR-031-qualify-and-contain-external-production-dependencies.md)
- [ADR-035](./ADR-035-add-agentdb-as-the-evidence-contexts-vector-memory.md)
- [ADR-036](./ADR-036-route-model-requests-through-agentic-flow.md)
- [Prompt 035-040 evidence](../implementation/prompt-035-040.md)
