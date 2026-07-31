# Prompts 026–032 implementation evidence

This increment implements locally verifiable policy and contract foundations for ADR-026 through ADR-032. It does not convert environment-dependent production claims into local assertions. Managed-cluster enforcement, provider qualification, failover, restore, identity-provider federation, browser-assisted accessibility review, and production release exercises remain external release gates.

## Sequential increments

1. **026 — regional cells:** trusted tenant/cell placement guard; restricted namespace; dedicated workload identities with short-lived audience-bound projected tokens; default-deny plus explicit edge, DNS, and private-dependency network paths; PDB, HPA, quotas, and deployment checks.
2. **027 — managed data plane:** provider-neutral blob and KMS ports; opaque tenant/cell partitions; AES-256-GCM authenticated encryption; wrapped data-key binding; hash verification; principal-bound access; and key-destruction erase.
3. **028 — durable fabric contracts:** managed queue port, tenant/event generation fencing, tenant-aware deduplication reference semantics, and round-robin admission fairness. A production durable adapter remains an environment qualification gate.
4. **029 — trusted identity:** Ed25519 issuer/key verification, bounded claim lifetime, audience/issuer/session claims, issuer-scoped replay prevention, workload cell/service/audience policy, and a production-disabled loopback-only header demo.
5. **030 — release authority:** signed complete release bundle, independently signed release authorization, builder/approver binding, policy digest, bounded authorization lifetime, allowlisted stage transitions, CAS deployment fencing, and replay rejection. Durable multi-replica approval consumption and production canary/rollback controllers remain release gates.
6. **031 — dependency qualification:** immutable version validation, default-deny catalog admission, expiry/region/data/purpose/drift checks, persistent quarantine, gateway admission, post-call requalification, generation fencing, cost-ceiling enforcement, and an explicit test-only allow adapter.
7. **032 — human-authority web:** separately runnable hardened SSR workload, semantic evidence-class/citation/dissent/assumption/limitation/abstention presentation, safe output encoding and links, security headers, reduced-motion/keyboard affordances, and removal of decision actions during abstention. Trusted session/BFF decision confirmation and assisted WCAG review remain release gates.

## Local evidence

- `npm run build`
- `npm run typecheck`
- `npm run architecture:check`
- `npm run contracts:validate`
- `npm run migrations:check`
- `npm run security:scan`
- `npm run licenses:check`
- `npm run deployment:check`
- `npm run shortcuts:check`
- `npm run test:coverage`
- `npm run benchmark`

The source receipt in `artifacts/evidence/source-receipt.json` binds tracked and untracked source content to one immutable snapshot digest. It declares local qualification only and forbids external claims.

## External release gates

- Kubernetes schema/admission validation and live default-deny/metadata-network tests.
- Managed PostgreSQL RLS, pool exhaustion, failover, PITR, backup no-resurrection, blob, and KMS rotation exercises.
- Durable workflow/broker crash-boundary, restart, upgrade, outage, cancellation, repair, DLQ, and noisy-neighbor tests.
- OIDC/SAML/SCIM, JWKS rotation, revocation, session epoch, cryptographic workload identity, and HTTP authorization journeys.
- Durable multi-controller release authorization, evidence-graph resolution, canary signals, signed rollback, rollback-health, and protection-drift exercises.
- Provider sandbox/qualified endpoint contract suites, continuous probes, credential rotation, deletion, billing, exit, and drift exercises.
- Authenticated web BFF decision intent/confirmation journeys, browser security tests, automated WCAG tooling, assisted screen-reader/keyboard/zoom/contrast review, and comprehension studies.
