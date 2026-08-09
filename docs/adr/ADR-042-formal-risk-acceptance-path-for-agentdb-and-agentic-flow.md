# ADR-042: A Formal Risk-Acceptance Path for AgentDB and agentic-flow

- **Status**: proposed
- **Date**: 2026-08-09
- **Deciders**:
- **Tags**: supply-chain, integrations, evidence, model-gateway

## Context

ADR-041 correctly holds AgentDB and agentic-flow at `qualifying` while their shared
`@huggingface/transformers → onnxruntime-node/sharp` chain carries 8 HIGH-severity `npm audit`
findings with no non-breaking fix. That is the right default, but it is also, as written, an
indefinite one: nothing in this repository currently defines what would ever move either
dependency to `eligible`, or who is allowed to decide that. Two real features —
`EvidenceSearchPort`'s AgentDB adapter (ADR-035) and `ModelGateway`'s cost-optimal selector
(ADR-036) — stay permanently inert without one of two things happening: the upstream advisory
chain clears, or someone with the authority to do so explicitly accepts the residual risk.

Waiting silently for an upstream fix is not a plan; it is the absence of one. This ADR defines
both paths so a decision is possible without re-litigating ADR-041's own reasoning each time.

## Decision

Two independent paths to `eligible`, either sufficient on its own:

1. **Clean upgrade path.** A scheduled check (extending `scripts/check-dependency-qualification.ts`
   or a sibling script) re-runs `npm audit` against the currently pinned `agentdb`/`agentic-flow`
   versions on a recurring cadence (weekly, alongside Dependabot's own cadence per ADR-034 item 6)
   and reports whether the HIGH-severity chain has cleared. When it has, qualification proceeds
   through the ordinary `ProductionDependency` lifecycle (`startQualification()` →
   `markEligible(true)` with real qualification evidence) — no new mechanism required.
2. **Explicit risk acceptance.** A `DependencyQualification` may be marked eligible while a known
   finding stands only when all of the following are true, each recorded as structured
   `details` on the qualification record (extending `DependencyQualification`'s existing shape,
   ADR-031) rather than left as an unrecorded judgment call:
   - the specific advisory IDs accepted, and why each is not exploitable in this platform's actual
     usage (e.g., "the `onnxruntime-node`/`sharp` embedding pipeline this platform's adapter never
     invokes — callers always supply their own embeddings" — already true for `AgentDbEvidenceSearchAdapter`, ADR-035);
   - an named, accountable approver distinct from whoever requests the acceptance (mirrors ADR-013's
     "author cannot be sole approver" rule, applied here to security risk rather than learning
     promotion);
   - an expiry no longer than the qualification's own `expiresAt`, forcing periodic re-review rather
     than a permanent waiver;
   - the accepted-risk qualification is itself listed in `docs/implementation/prompt-035-040.md` (or
     its successor) so it is visible outside the source tree, not just inside a passing test.

Neither path is exercised by this ADR — it defines the two ways forward and the evidence each
requires; deciding to actually invoke path 2 for a specific advisory is a separate, later
decision by whoever holds that authority for this repository.

## Consequences

### Positive

- Replaces indefinite silence with two concrete, evidenced paths, either of which unblocks real
  product features.
- Risk acceptance, if ever used, is structured and expiring rather than an unrecorded exception —
  consistent with how `scripts/check-licenses.ts`'s `missingLicenseExceptions` already requires a
  verified, named justification rather than a blanket bypass.

### Negative

- Path 2 introduces judgment ("is this advisory exploitable in our actual usage") that a script
  cannot fully automate — a human decision is unavoidable, and this ADR does not reduce the
  seriousness of getting that judgment wrong.
- A recurring audit-check adds one more scheduled job to operate and to notice when it silently
  stops running.

### Neutral

- This ADR does not change ADR-041's default (still `qualifying`, still refused by
  `denyUnqualifiedModelDependencies`/the Evidence context's equivalent) — it only names what would
  ever change that default.

## Links

- [ADR-013](./ADR-013-restrict-learning-to-observed-outcomes-and-gated-promotion.md)
- [ADR-031](./ADR-031-qualify-and-contain-external-production-dependencies.md)
- [ADR-034](./ADR-034-close-multi-replica-and-attack-surface-gaps-in-the-wired-runtime.md)
- [ADR-035](./ADR-035-add-agentdb-as-the-evidence-contexts-vector-memory.md)
- [ADR-036](./ADR-036-route-model-requests-through-agentic-flow.md)
- [ADR-041](./ADR-041-hold-supply-chain-blocked-dependencies-at-qualifying-not-eligible.md)
