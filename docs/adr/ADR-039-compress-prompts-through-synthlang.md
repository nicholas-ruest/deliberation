# ADR-039: Compress Prompts Through SynthLang as a Qualified External Dependency

- **Status**: proposed
- **Date**: 2026-08-09
- **Deciders**:
- **Tags**: model-gateway, cost, integrations, synthlang

## Context

ADR-016 requires budgets (tokens, money, wall time) to be reserved before a scenario tree starts and metered without exception. Prompt/template token cost is a direct input to that budget, and today it is whatever the raw prompt template produces — nothing compresses or optimizes it.

`github.com/ruvnet/SynthLang` is a Python prompt-compression language: it re-expresses prompts through logographical/symbolic constructs to cut token count while preserving intent, aimed at models like GPT-4o. It is not published to npm (Python, `pip install` only per the founding research notes on this same ecosystem) and has no Node binding.

## Decision

Qualify SynthLang as an external production dependency through the same `ProductionDependency`/ADR-031 path as ADR-038, run as a sidecar the model gateway calls to transform a prompt template *before* it is sent to a provider — never after a response is generated, and never touching model output. The transformation is deterministic and logged: every generated artifact's routing manifest (ADR-010) records both the original `promptTemplateHash` and the compressed variant's hash, so reproducibility and evidential reconstruction are unaffected — a run can still be traced to exactly what was sent.

SynthLang's output is treated as untrusted transformed input, not trusted prompt content: it passes through the same typed prompt-validation boundary ADR-017 already requires for all prompts, after compression, before it reaches a model adapter. Compression is opt-in per routing policy (a `ModelRoute` may declare whether it accepts a compressed variant) — high-risk-tier or restricted-data requests can require the uncompressed template, since compression is a cost optimization, not a safety-relevant transformation, and this ADR does not ask anyone to trust that logographic re-expression preserves meaning for consequential prompts without evidence.

## Consequences

### Positive

- Directly reduces the token cost ADR-016 requires the platform to reserve and meter, on the highest-cost line item (generation/evaluation prompts) without changing model selection.
- Kept optional per route, so risk-sensitive paths are never forced through an unverified compression step.

### Negative

- Compression is a meaning-preservation claim with no first-party evidence in this repository yet; a compressed prompt that silently drops or distorts a constraint is a correctness risk, not just a cost one — this needs its own held-out evaluation (comparing compressed vs. uncompressed output quality) before being enabled broadly, following the same non-regression discipline ADR-018 already requires of any change.
- A Python sidecar with no registry presence has the same supply-chain blind spot as ADR-038's RuLake integration.

### Neutral

- SynthLang is scoped to outbound prompt construction only in this ADR; it is not adopted as a general text-processing dependency elsewhere in the platform.

## Links

- [ADR-010](./ADR-010-use-versioned-model-routing-and-reproducibility-manifests.md)
- [ADR-016](./ADR-016-reserve-and-meter-compute-before-execution.md)
- [ADR-017](./ADR-017-secure-the-software-and-ai-supply-chain.md)
- [ADR-018](./ADR-018-require-evidence-based-release-quality-gates.md)
- [ADR-031](./ADR-031-qualify-and-contain-external-production-dependencies.md)
