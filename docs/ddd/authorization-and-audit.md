# Authorization, approval, and audit contract

Authentication establishes an identity. Authorization decides whether that identity may perform one action on one resource for one purpose under current risk, consent, tenant, entitlement, and environmental conditions.

## Policy input

Every decision evaluates a trusted input:

```text
subject: principal/workload ID, tenant memberships, role/attributes,
         authentication strength, session epoch, support case?
action: stable command/query/tool/export/admin action
resource: tenant, type, ID, owner, state, classification, region
context: purpose, risk tier, consent, safety case, current time,
         network/workload posture, request region, emergency mode
commercial: entitlement and reservation references
```

The result is `allow`, `deny`, or `allow-with-obligations`, plus stable reason codes, policy version, decision ID, expiry, and obligations. Deny overrides allow. Missing attributes, policy timeout, unsupported policy version, or unverifiable resource scope deny consequential actions.

Obligations include step-up authentication, consent, second approval, designated reviewer role, justification, masking, watermark, export encryption, customer notification, maximum budget, restricted provider, or read audit. Application services must prove each obligation before executing.

## Baseline roles

Roles are tenant scoped and composable:

| Role | Intended authority | Explicit exclusions |
|---|---|---|
| `member` | own/assigned deliberations and preferences | policy, billing, audit, tenant admin |
| `facilitator` | manage assigned cases and stakeholders | record another authority’s decision |
| `reviewer` | review briefs within competence/risk scope | change evaluation or self-approve |
| `identity-admin` | federation, SCIM, membership | customer content by default |
| `policy-admin` | draft policy and safety cases | sole activation of own change |
| `connector-admin` | register/configure connectors | approve prohibited writes or view secrets |
| `billing-admin` | plan, quota, invoices, usage totals | deliberation content |
| `audit-reader` | scoped audit query/export | mutate ledger or customer content |
| `data-governance-admin` | retention, export, hold, erasure | bypass legal/policy approval |
| `support-requester` | open case and grant scoped access | permanent support access |
| `tenant-owner` | allocate roles and recover ownership | unrestricted content or control bypass |

Platform operators have workload-specific operational permissions, not implicit tenant roles. Database, queue, and cloud console access does not grant domain authorization.

## High-impact action matrix

| Action | Required controls |
|---|---|
| Activate policy/safety case | policy admin proposes; independent approver; passing fixtures; effective time |
| Publish high-risk brief | current safety case; competent reviewer; complete provenance; no unresolved hard failure |
| Record human decision | named decision authority; step-up for configured tiers; immutable rationale/reference |
| Approve connector write | connector admin + policy decision; schema digest; target scope; second approval by risk |
| Export content/audit | export grant; purpose; scope preview; step-up; encrypted destination; audit |
| Apply/release legal hold | data-governance authority; case/legal basis; separation of duties |
| Erase tenant/data subject | verified order; hold evaluation; completion proof; no support override |
| Change plan/hard quota | billing/contract authority; effective date; reconciliation; customer notice |
| Access customer content for support | customer case/consent; just-in-time grant; masking; expiry; audited fields |
| Promote model/prompt/verifier | independent release gate; signed artifact; evaluation receipt; canary/rollback |
| Break glass | declared incident; strong auth; limited action set; time bound; real-time alert; review |

No role may approve its own high-impact proposal where separation of duties is required. Approval delegation is explicit, bounded by action/resource/risk/time, and cannot be delegated onward unless policy says so.

## Resource and list-query security

- Authorize the collection and enforce tenant/resource predicates inside the owner’s repository.
- Never load a cross-tenant resource and then filter it in application memory.
- Field-level masking occurs before serialization and cache population.
- Counts, existence, timing, errors, search facets, and cursors must not leak unauthorized resources.
- Bulk actions authorize each item or an equivalent constrained set proven by policy; partial outcomes are explicit.
- Authorization caches key by tenant, subject session epoch, resource version/classification, action, purpose, and policy version. Revocation invalidates them within the ADR-011 SLO.

## Workload and delegated authority

Every worker, workflow, projection consumer, migration, support tool, and connector gateway has a named workload identity. A command delegated to a worker carries a signed capability containing tenant, allowed action, resource, purpose, budget, expiry, workflow and fencing generation. Workers cannot widen it. Credentials are audience bound and short lived.

Workflow resumption re-evaluates authorization at consequential boundaries. A prior allow is not a perpetual capability. Canonical facts already committed remain valid; newly denied downstream effects stop safely.

## Audit event classes

| Class | Examples | Required outcome |
|---|---|---|
| Security | login failure, role change, revocation, break glass | near-real-time seal and alert by severity |
| Data access | privileged read, search/export, support bundle | purpose, scope, masking, case reference |
| Decision | case scope, review, brief publication, human decision | artifact/policy/input digests |
| External effect | model/tool/connector/write invocation | destination/capability, approval, usage, result digest |
| Governance | consent, hold, erasure, policy activation | authority, basis, obligations, proof references |
| Commercial | reservation, usage, quota, suspension | dimensions only; no decision content |
| Release | build/config/model/prompt migration promotion | exact immutable inputs and approval receipt |

Audit records distinguish request, authorization decision, attempted effect, and observed outcome. An attempted external write is not recorded as successful until the response is verified or reconciled.

## Break-glass protocol

Break glass is available only for declared incident classes and a minimal action allowlist. It requires a separately protected identity, phishing-resistant authentication, incident reference, explicit reason, short expiry, and real-time security/customer notification as policy requires. It cannot disable tenant boundaries, forge approvals, mutate the audit ledger, export arbitrary content, or promote releases. Every use triggers independent review and credential rotation.

## Acceptance evidence

- A generated test enumerates every public action and proves an explicit policy rule and audit classification exist.
- Mutation testing verifies removal of tenant, purpose, session epoch, or resource predicates causes test failure.
- Revocation, stale-cache, confused-deputy, IDOR, bulk-action, side-channel, and support-access suites pass.
- High-impact journeys prove separation of duties and cannot be completed by one identity.
