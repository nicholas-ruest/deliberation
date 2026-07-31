# Prompts 01–18 implementation and evidence map

- **Scope:** `.plans/implementation-prompts.md` Prompts 01–18
- **Source state:** dirty-worktree snapshot; bind exact files with the release-evidence script before promotion
- **Evidence levels:** `local-pass`, `environment-qualified`, `external-required`

“Implemented surface” means a domain contract or locally executable reference exists. It does not imply that every prompt is complete end to end, or turn emulated dependencies and one-time drills into a production claim.

| Prompt | Implemented surfaces | Local evidence | Remaining qualification |
|---|---|---|---|
| 01 | ten context boundaries, shared envelopes/results/idempotency, JSON Schema/OpenAPI/AsyncAPI, architecture/migration checks, CI | `npm run quality`; forbidden dependency rules | consumer fleet compatibility in deployed release |
| 02 | pinned lock/images, boundary validator, capability tokens, kill switches, non-root/read-only container policy, source security scan, SBOM CI | zero npm audit; container build/sandbox inspection; security tests | trusted CI signing identity, registry policy, network policy enforcement |
| 03 | ten PostgreSQL schemas, RLS, runtime roles, CAS SQL store, encrypted in-memory object port, migrations | live pinned-PostgreSQL RLS tests; mocked aggregate/outbox transaction contract | context repository adapters, real-DB CAS/rollback tests, managed object store/KMS, PITR and production-shaped restore |
| 04 | Tenant/Principal, membership/session epoch, subject resolver, OIDC/SAML/SCIM port boundary | invariant and cache behavior tests | live enterprise IdP interoperability and distributed revocation SLO |
| 05 | PolicySet, ConsentRecord, SafetyCase, deny override, obligation values, separation of duties | authority/governance domain tests | application-wide obligation enforcement, approved owners and jurisdiction review |
| 06 | in-memory outbox/inbox relay and workflow reference with retry/cancel/compensation/dead-letter/repair states | workflow contract tests | PostgreSQL workflow store, queue-connected worker, timed retries, crash recovery, deployed broker durability and chaos qualification |
| 07 | DeliberationCase and PreferenceProfile lifecycle, snapshots, vetoes, human-only decision; opt-in local composition demo | domain journey tests | authenticated command pipeline, persistent HTTP resources, UI and accessibility |
| 08 | ProductPlan, CustomerContract, Entitlement, reservation/usage/release | commercial tests | billing-provider and invoice reconciliation contracts |
| 09 | EvidenceRecord, encrypted artifacts, provenance, epistemic classes, supersession/restriction | epistemic-integrity tests | production ingestion malware/DLP and KMS |
| 10 | provider-neutral model gateway, versioned route policy, immutable model IDs, manifests | deterministic provider/routing tests | live provider residency, retention, quality, cost and outage evidence |
| 11 | ConnectorRegistration and mandatory gateway, schema/identity pinning, egress allowlist, write obligations, quarantine fencing | connector gateway/security tests | secrets manager, network egress enforcement, live MCP interoperability |
| 12 | ScenarioTree budgets/lineage/leases/cancellation plus start-run saga domain service | planning and saga tests | queue-connected worker, durable orchestration, capability enforcement, model/tool execution, distributed scale and fairness qualification |
| 13 | BranchMemoryPort, in-memory delta reference, pinned Agenticow 0.2.4 native adapter, basic fork/read/write/discard contract and local benchmark | adapter contract and unpersisted local microbenchmark | complete shared erase/promotion/isolation/crash suite, stored benchmark receipt, PostgreSQL/object baseline, representative recall/resource/cost workload and policy enablement |
| 14 | EvaluationRun, precedence/hard constraints, Pareto/sensitivity/abstention, immutable cited brief | evaluation tests | domain verifier/calibration datasets and UI accessibility |
| 15 | OutcomeRecord, calibration, LearningCandidate, independent approval and canary/rollback state model | learning tests | monitored deployment actions, statistically powered held-out, fairness/privacy and signed release evidence |
| 16 | erasure process-manager contract, nine-surface coverage registry, restriction/hold/backup outcomes, evidence report | mock-participant complete-surface test | concrete durable participants, provider/KMS deletion, backup expiry and no-resurrection restore drill |
| 17 | OTel-safe wrapper, SLI evaluator, SLO/alert config, deployment-policy manifests, three runbooks, fail-closed health endpoints | telemetry leak/SLI tests; image smoke; build | runtime-wide instrumentation, queue worker, collectors/pagers, multi-AZ, production load, PITR, regional exercise history |
| 18 | source-bound risk-tiered release gate, Ed25519 approval verification, non-weakenable evidence policy, six acceptance journeys, prohibited-shortcut registry, canary rollback state, pinned CI actions, build/benchmark/evidence gates | 77 passing tests; 87.04% statement coverage; build/type/contracts/architecture/migrations/security/deployment/sandbox/audit pass; local benchmark and source receipt | external signer/identity authorization, real staged deployment controller, production canary/probe results, WCAG assisted review, penetration test, provider/component environments, statistically powered customer/strong-model baselines, restore/DR exercise history |

## Current local commands

```bash
npm run quality
npm run build
npm audit --audit-level=low
npm sbom --sbom-format cyclonedx
npm run benchmark
```

The PostgreSQL component suite requires `TEST_DATABASE_URL` after applying `migrations/*.sql`. It is intentionally skipped when no database is supplied. A local run exercised the three RLS cases against the digest pinned in CI, but the current source receipt records source identity only—not command execution—so that run is not durable release evidence.

## Benchmark interpretation

`benchmarks/branch-memory.bench.ts` compares the in-process delta reference with the pinned Agenticow 0.2.4 native adapter under identical key-overlay operations. This local microbenchmark is not a PostgreSQL/object baseline or a representative vector-recall workload and cannot by itself justify enabling Agenticow. Policy enablement additionally requires crash recovery, recall, latency, memory, portability, and cost evidence on production-shaped data.

## Explicit non-claims

Local evidence does not prove:

- production availability, multi-AZ durability, RPO/RTO, or annual/quarterly exercise history;
- compliance certification or legal suitability for a jurisdiction/use case;
- real provider/model/connector/billing/IdP behavior without configured qualification environments;
- artifact identity/trust without an authorized release signer and immutable deployment digest;
- commercial viability, user outcome improvement, fairness, or calibration without prospective customer data and controlled evaluation.

Prompt 18's local release-gate implementation is present. It intentionally rejects production promotion until every source-bound environment/external evidence item and independent approval required by `config/operations/release-policy.json` is supplied. Local test success is not production qualification.

The HTTP laboratory route is disabled by default. `ALLOW_LOCAL_DOMAIN_DEMO=true` enables it only for trusted local domain demonstrations; its headers and request-supplied governance/evidence fields are not an authentication or production authorization mechanism.
