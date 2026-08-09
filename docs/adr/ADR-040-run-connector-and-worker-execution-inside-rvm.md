# ADR-040: Run Connector and Worker Execution Inside RVM as a Qualified Sandboxed Substrate

- **Status**: proposed
- **Date**: 2026-08-09
- **Deciders**:
- **Tags**: security, sandbox, integrations, scenario-planning, rvm

## Context

ADR-017 requires a worker sandbox profile with a read-only base image, no ambient credentials, controlled egress, and short-lived capability-token injection. Today that isolation is provided entirely by the container/Kubernetes layer (`securityContext`, dropped capabilities, `readOnlyRootFilesystem` — see `config/kubernetes/worker-deployment.yaml` and `Dockerfile.worker`): process-level isolation inside a pod, not isolation of one untrusted MCP tool call or scenario-branch rollout from another running in the same worker process.

`github.com/ruvnet/rvm` is a Rust, `no-std`, bare-metal microhypervisor built for exactly this narrower boundary: per-task capability-scoped isolation "for the agentic age." It has no npm package and is not meant to be embedded as a library — it is designed to run as its own execution substrate that a caller dispatches work into.

## Decision

Qualify RVM as an external production dependency through `ProductionDependency`/ADR-031, the same path as ADR-038 and ADR-039, scoped narrowly to two call sites that already assume per-task isolation but don't yet have it below the pod level:

1. **Integrations' MCP tool execution** (ADR-008): a connector tool call dispatches into an RVM instance instead of running in the worker process directly, so a compromised or malicious tool response cannot affect a second, concurrent tool call or the worker's own state — narrower than today's pod-level blast radius.
2. **Scenario Planning's isolated workers** (ADR-006): a single scenario-branch rollout runs inside its own RVM instance, so budget/lease enforcement has a hard execution boundary underneath the existing lease/lineage logic, not just cooperative worker code.

RVM instances receive only the short-lived, capability-scoped tokens ADR-017 already mandates be issued to workers — RVM does not get a broader credential than the worker it replaces would have had. A tool call or branch rollout that exceeds its declared budget or capability set is terminated by RVM itself, in addition to (not instead of) the existing budget/lease checks in `ScenarioTree` and the connector gateway.

This is the heaviest-lift integration in this series: RVM is `no-std`/bare-metal, has no existing Node integration path, and this ADR does not resolve what the actual dispatch mechanism (process boundary, VM boundary, syscall interface) looks like — that is deliberately left to implementation, qualified and reviewed like any other production dependency, not decided by this ADR.

## Consequences

### Positive

- Adds a real per-task isolation boundary below pod-level isolation, directly closing the gap ADR-017's sandbox requirement describes but doesn't fully provide today.
- Reuses the existing dependency-qualification and kill-switch machinery rather than inventing a new one.

### Negative

- Highest integration cost of this series by a wide margin: no existing binding, bare-metal/no-std Rust, and an unresolved dispatch mechanism. This should not be scheduled before ADR-035–037, which have concrete, much shorter paths to value.
- A hypervisor boundary that fails closed incorrectly (terminates legitimate work) becomes a new source of false-positive budget/lease failures that ADR-006's acceptance criteria would need to re-cover.
- Sandbox tests (`npm run sandbox:test`, ADR-017's acceptance evidence) need a second tier: today's tests prove pod-level isolation; this needs its own tests proving RVM-level isolation, not a rename of the existing suite.

### Neutral

- This ADR does not remove or weaken the existing container-level sandbox (ADR-017, `Dockerfile.worker`); RVM is a boundary underneath it, not a replacement for it.

## Links

- [ADR-006](./ADR-006-use-budgeted-central-orchestration-and-isolated-workers.md)
- [ADR-008](./ADR-008-secure-mcp-behind-a-policy-enforcing-gateway.md)
- [ADR-017](./ADR-017-secure-the-software-and-ai-supply-chain.md)
- [ADR-031](./ADR-031-qualify-and-contain-external-production-dependencies.md)
