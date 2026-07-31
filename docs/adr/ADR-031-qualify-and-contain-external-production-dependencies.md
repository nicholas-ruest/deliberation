# ADR-031: Qualify and Contain External Production Dependencies

- **Status**: proposed
- **Date**: 2026-07-31
- **Deciders**:
- **Tags**: providers, connectors, identity, billing, qualification

## Context

The platform has provider-neutral ports and deterministic fakes, but production behavior depends on model, embedding, reranking, identity, billing, email, connector, workflow, and storage providers. Passing local mocks does not establish residency, retention, schema stability, cost, quality, or failure behavior.

## Decision

Maintain a versioned dependency catalog. Each production dependency entry records owner, purpose, data classes, regions, subprocessors, immutable API/model/version identifiers, authentication method, retention/training terms, quotas, SLO, cost limits, contract fixtures, kill switch, fallback, degradation behavior, and exit plan.

No dependency becomes production-eligible until it passes a provider-specific qualification environment using synthetic or approved test data. Qualification covers contract behavior, identity, residency, retention, timeout/retry semantics, rate limits, billing reconciliation, safety/privacy controls, observability, outage handling, and deletion where applicable.

All adapters fail closed at typed boundaries. Fallbacks may reduce capability but cannot weaken policy, residency, provenance, or human authority. Circuit breakers and kill switches stop new work while preserving cancellation, audit, and repair. Provider status pages are never treated as proof of correct platform behavior.

Continuous synthetic probes contain no customer content. Material provider drift—identity, model alias, schema, safety behavior, terms, region, or cost—automatically removes eligibility or requires a new reviewed version.

## Consequences

- Provider onboarding is an engineering and governance process, not a configuration toggle.
- Some regions or features remain unavailable when no qualified dependency exists.
- Portability is preserved, but equivalent quality and cost across providers are not assumed.

## Rejected alternatives

- **Trusting local mocks**: cannot prove external semantics.
- **Automatic fallback to any available provider**: can violate policy and residency.
- **Mutable “latest” model identifiers**: prevent reproducibility and drift detection.

## Acceptance evidence

- Contract suites pass against sandbox and production-qualified endpoints.
- Residency, retention, deletion, and no-training claims are verified and periodically reviewed.
- Outage, throttling, malformed response, billing mismatch, and credential rotation exercises pass.
- Kill switches and quarantine reject new and in-flight untrusted results.
- Exit drills demonstrate export, credential revocation, and replacement without domain contract changes.

## Links

- [ADR-008](./ADR-008-secure-mcp-behind-a-policy-enforcing-gateway.md)
- [ADR-010](./ADR-010-use-versioned-model-routing-and-reproducibility-manifests.md)
- [ADR-017](./ADR-017-secure-the-software-and-ai-supply-chain.md)
