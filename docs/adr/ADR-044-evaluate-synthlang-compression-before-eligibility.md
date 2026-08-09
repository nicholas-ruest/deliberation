# ADR-044: A Held-Out Evaluation Gate for SynthLang Compression Before Eligibility

- **Status**: proposed
- **Date**: 2026-08-09
- **Deciders**:
- **Tags**: model-gateway, evaluation, synthlang

## Context

ADR-039 wired a real SynthLang sidecar and a real `PromptCompressor` adapter, opt-in per
`ModelRoute.acceptsCompressedPrompt`, and correctly left its `ProductionDependency` qualification
at `qualifying`: compression is a token-cost optimization with no evidence yet that it preserves
meaning for this platform's actual prompts. That finding named the gap; it did not build the gate
that would close it. Without one, "eligible" has no defined bar to clear other than someone
deciding it informally.

ADR-018 already requires exactly this kind of evidence — "held-out improvement... without safety,
privacy, fairness, latency, or cost regression" — for learning-candidate promotion (ADR-013). This
ADR applies the same discipline to a different kind of change: a cost optimization applied to
model input rather than a learned model change, but the standard of proof should not be lower
because the mechanism is simpler.

## Decision

Before any `ModelRoute` may set `acceptsCompressedPrompt: true` in a production routing policy,
and before SynthLang's `ProductionDependency` may reach `eligible`:

1. **Build a held-out prompt set** representative of this platform's real prompt shapes — generation,
   embedding-adjacent, structured-evaluation tasks per `ModelTask` (`model-gateway.ts`) — sourced
   from recorded `GeneratedArtifact.promptTemplateHash` history where available, or a curated
   fixture set otherwise. Held-out means never used to tune the compression step itself.
2. **Run each prompt through both the uncompressed and SynthLang-compressed path**, using the same
   model/provider for both, and record for each pair: token count (cost signal, ADR-016), and
   output quality by the evaluation hierarchy ADR-009 already establishes (deterministic
   checks/verifiers first; a generic LLM judge alone is insufficient per that ADR and per the
   founding research in `.plans/deliberation-deep-research.md`, which explicitly warns a cheap
   LLM-judge was a negative selector in adjacent work).
3. **Compute a calibration-style comparison** (mirroring `evaluateSli`/`computeCalibration`'s
   existing pattern in this codebase — same shape, applied to compression quality instead of
   provider reliability): pass/fail against a stated non-regression bar, not a vibes-based
   "looks fine" read.
4. **Gate on the result, not the attempt.** A compression pass that shows quality regression on
   any material claim category (per ADR-005's epistemic classes) fails the gate; token savings do
   not offset a correctness regression on a consequential decision input. Only a pass moves
   SynthLang toward `eligible` and permits any route to opt in.
5. **Re-run on every SynthLang version bump.** The evaluation is bound to the qualified
   `immutableProviderVersion` exactly as any other `DependencyQualification` is (ADR-031); an
   upgrade re-opens the gate, it does not inherit a prior pass.

This ADR does not run the evaluation — it defines what "safe to use even opt-in" concretely means,
so that when someone does run it, pass/fail is not a judgment call invented at that moment.

## Consequences

### Positive

- Turns "no evaluation exists yet" from a permanent-sounding blocker into a defined, achievable
  piece of work with a clear finish line.
- Reuses this platform's own evaluation machinery (ADR-009's verifier precedence, calibration
  patterns already in `src/learning/domain/services/calibration.ts`) instead of inventing a
  parallel one just for this feature.

### Negative

- Building a representative held-out prompt set is real, non-trivial work, and a poorly
  representative set produces a pass that does not generalize — the evaluation is only as good as
  the fixture behind it.
- Any future prompt-transformation dependency (not just SynthLang) that this platform adopts later
  needs the same gate, which this ADR does not automate into a reusable script — that is a
  reasonable follow-up once a second such dependency is actually proposed, not before.

### Neutral

- Compression stays opt-in per route regardless of outcome (ADR-039); this ADR only defines when
  a route is allowed to opt in, not whether compression becomes a platform default.

## Links

- [ADR-005](./ADR-005-make-provenance-and-epistemic-classification-mandatory.md)
- [ADR-009](./ADR-009-use-multi-objective-evaluation-with-abstention.md)
- [ADR-013](./ADR-013-restrict-learning-to-observed-outcomes-and-gated-promotion.md)
- [ADR-016](./ADR-016-reserve-and-meter-compute-before-execution.md)
- [ADR-018](./ADR-018-require-evidence-based-release-quality-gates.md)
- [ADR-031](./ADR-031-qualify-and-contain-external-production-dependencies.md)
- [ADR-039](./ADR-039-compress-prompts-through-synthlang.md)
