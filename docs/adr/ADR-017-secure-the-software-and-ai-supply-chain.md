# ADR-017: Secure the Software and AI Supply Chain

- **Status**: proposed
- **Date**: 2026-07-23
- **Deciders**:
- **Tags**: security, supply-chain, threat-model

## Context

The system executes model output, parses hostile evidence, calls external tools, and depends on young AI libraries. Conventional application threats combine with prompt injection, tool abuse, model drift, poisoned retrieval, dependency compromise, and cross-tenant inference.

## Decision

Adopt a secure development lifecycle with repository protection, reviewed threat models, least-privilege CI, pinned lockfiles and images, dependency/license policy, SAST/SCA/IaC/secret/container scans, SBOMs, signed provenance and releases, reproducible builds where practical, and rapid revocation/rollback.

Sandbox workers with no ambient credentials, read-only base images, CPU/memory/time limits, controlled network egress, and short-lived capability tokens. Treat prompts, retrieved content, connector schemas/results, and model output as untrusted. Validate all structured output and require deterministic/policy checks before side effects. Maintain AI-specific red-team suites and dependency kill switches for agenticow, SAFLA, model providers, and connectors.

## Consequences

### Positive

- Reduces software, connector, and agentic attack surface.
- Creates enterprise procurement evidence and rapid containment mechanisms.

### Negative

- Slower dependency upgrades and higher CI/security operating cost.
- Sandboxing restricts some tools and local deployment modes.

### Neutral

- Security exceptions are time-bounded, risk-accepted, and auditable.

## Links

- [ADR-008](./ADR-008-secure-mcp-behind-a-policy-enforcing-gateway.md)
- [ADR-011](./ADR-011-enforce-tenant-isolation-and-zero-trust-authorization.md)
- [ADR-018](./ADR-018-require-evidence-based-release-quality-gates.md)
