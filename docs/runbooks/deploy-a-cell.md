# Cell deployment from the Kustomize base

`config/kustomize/base` references the canonical manifests in `config/kubernetes` without copying them. The `dev`, `staging`, and `prod` overlays are illustrative examples, not operated environments.

1. Copy the overlay closest in shape to the target environment. Do not deploy the examples unchanged.
2. Set the namespace and `deliberation.io/cell-id` to a cell you actually operate, and keep the private-dependency egress policy consistent with that same cell.
3. Bind `CELL_API_IDENTITY_REQUIRED`, `CELL_WORKER_IDENTITY_REQUIRED`, and `CELL_WEB_IDENTITY_REQUIRED` to the workload identities your cluster issues.
4. Replace every `RELEASE_DIGEST_REQUIRED` with the digest of a signed release image whose signature and provenance you have verified. Never deploy a mutable tag.
5. Size replicas, autoscaling bounds, disruption budget, container resources, and the namespace quota against measured load, not against the example values.
6. Render and review the complete manifest before applying: `kubectl kustomize config/kustomize/overlays/<environment>`.
7. Confirm the rendered output still carries restricted pod security, default-deny networking, dedicated service accounts, topology spreading, and audience-bound projected tokens.
8. Apply through your own change-control path with independent release authorization and environment-qualified evidence.

Cluster provisioning, regional cell placement, workload identity, secret material, and image digests are adopter-owned. This repository ships the manifest shape and the checks that reject unresolved placeholders; it does not operate any cluster.
