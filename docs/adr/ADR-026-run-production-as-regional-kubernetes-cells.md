# ADR-026: Run Production as Regional Kubernetes Cells

- **Status**: proposed
- **Date**: 2026-07-31
- **Deciders**:
- **Tags**: runtime, kubernetes, cells, networking, availability

## Context

The local API and worker processes prove domain behavior but provide no scheduler, workload identity, network enforcement, autoscaling, disruption handling, or regional isolation. ADR-022 requires cells but does not choose the production substrate or define the unit of deployment.

## Decision

Run the API, workflow workers, connector gateway, and operational agents as separate OCI workloads on managed Kubernetes. A production cell is one region-scoped Kubernetes cluster or independently operated cluster slice with its own ingress, workload identities, queues, database endpoints, object storage namespace, encryption keys, telemetry pipeline, quotas, and failure budget.

Use separate namespaces and service accounts per environment and workload class. Enforce Pod Security Standards, default-deny ingress and egress, signed digest-only images, read-only roots, non-root users, dropped capabilities, resource requests/limits, topology spread, disruption budgets, and controlled temporary storage. Only the connector/model egress gateway may reach approved external endpoints.

Tenant placement is explicit and residency-aware. Requests carry a trusted cell assignment established at the edge; workloads cannot select another cell. Cross-cell domain transactions are forbidden. Global services may route, catalog, or aggregate content-free health, but cannot become a bypass around tenant policy or a synchronous dependency for an active cell.

Infrastructure is declared through reviewed, versioned infrastructure-as-code and reconciled by a deployment controller. Operators do not apply production manifests from laptops. Development may use a single local cluster, but it must exercise the same identities, probes, policies, and manifest interfaces.

## Consequences

- Cells bound failure and residency, and API/worker scaling becomes independent.
- Kubernetes, network policy, workload identity, and cluster lifecycle become production competencies.
- Multi-region availability requires duplication and controlled tenant evacuation rather than one stretched database.

## Rejected alternatives

- **Single VM or Compose deployment**: insufficient isolation, rollout, and recovery controls.
- **One global cluster and database**: creates an excessive blast radius and residency coupling.
- **Serverless functions for all workloads**: poorly matches long-running, leased, and sandboxed workflows.

## Acceptance evidence

- A clean environment is recreated from immutable infrastructure inputs without manual mutation.
- Default-deny tests prove API and workers cannot reach unapproved services or cloud metadata.
- Node, zone, pod, and cell failure exercises preserve stated SLOs or return honest unavailability.
- Tenant routing and residency tests reject cross-cell execution and storage.
- Autoscaling and overload tests pass forecast peak plus approved headroom.

## Links

- [ADR-006](./ADR-006-use-budgeted-central-orchestration-and-isolated-workers.md)
- [ADR-015](./ADR-015-operate-with-slos-open-telemetry-and-disaster-recovery.md)
- [ADR-020](./ADR-020-treat-deployment-configuration-and-secrets-as-versioned-products.md)
- [ADR-022](./ADR-022-use-cell-based-failure-isolation-and-admission-control.md)
