# ADR-049: Discover Worker Tenants From Identity & Access, Not a Static Env Var

- **Status**: proposed
- **Date**: 2026-08-09
- **Deciders**:
- **Tags**: worker, identity-access, multi-tenancy

## Context

`src/apps/worker.ts` (ADR-033) relays each tenant's outbox by iterating a fixed list from
`WORKER_TENANT_IDS`, an operator-supplied comma-separated env var. That ADR named this explicitly
as a reference-implementation limitation: real tenant discovery would require either a privileged,
cross-tenant database role (which the RLS design this platform relies on deliberately makes hard
to grant safely) or an application-level tenant registry query, and building that safely was
out of scope at the time. It is still true today, and it means onboarding a new tenant requires an
operator to edit worker configuration and redeploy — the platform's own `Tenant` aggregate
(`src/identity-access/domain/entities/tenant.ts`, stored as `aggregate_type = 'Tenant'` in
`identity_access.aggregates`) already has everything needed to answer "which tenants exist," but
the worker cannot see it under the same tenant-scoped connection every other read in this platform
correctly uses.

## Decision

Add a narrow, security-definer-scoped discovery path rather than either a broad RLS-bypass role or
continuing to require static configuration:

1. **A new migration** creates one SQL function, `identity_access.list_active_tenant_ids()`,
   `SECURITY DEFINER`, owned by a role with the narrowest possible grant (`SELECT` on
   `identity_access.aggregates` only, not `BYPASSRLS`), returning tenant IDs for `Tenant`
   aggregates whose `state` (per `tenant.ts`'s own lifecycle) is active — mirroring the
   `SECURITY DEFINER`-function pattern this platform already uses correctly elsewhere
   (`public.current_tenant_id()`, migration 0002) rather than introducing a new privilege model.
2. **A dedicated, minimal worker role** (`deliberation_worker_discovery_runtime`, granted `EXECUTE`
   on that one function only, nothing else) is the only principal permitted to call it — the
   worker's existing per-schema `deliberation_<context>_runtime` roles (ADR-033) remain unchanged
   and still cannot read across tenants for anything else.
3. **`worker.ts` calls this once per poll interval** (or on a slower, separately configurable
   cadence, since tenant churn is far less frequent than outbox relay) to refresh its working
   tenant set, replacing `WORKER_TENANT_IDS` as the default source. The env var is not removed —
   it becomes an explicit override for single-tenant or constrained deployments that want to skip
   discovery entirely, which stays a legitimate, simpler configuration for smaller adopters.
4. **A tenant transitioning out of `active` state stops being relayed for on the next discovery
   cycle**, not immediately — this is an acceptable staleness window (bounded by the poll
   interval) consistent with the eventual-consistency posture the outbox pattern (ADR-004) already
   has everywhere else.

## Consequences

### Positive

- Removes a real onboarding friction point (editing worker config and redeploying per new tenant)
  without weakening tenant isolation — the new role can enumerate IDs, nothing else; every actual
  outbox read/write still goes through the existing tenant-scoped `SET LOCAL ROLE` +
  `set_config('app.tenant_id', ...)` pattern (ADR-033) unchanged.
- Consistent with, not a departure from, this platform's existing `SECURITY DEFINER` precedent —
  no new privilege category is introduced.

### Negative

- A `SECURITY DEFINER` function is a real, if narrow, privilege escalation surface; it needs the
  same migration-review scrutiny as any RLS-adjacent change, and a bug in its `WHERE` clause is a
  cross-tenant information disclosure, not a cosmetic one.
- Adds one more moving part (a discovery poll, a new role, a new migration) to a component
  (`worker.ts`) ADR-033 explicitly scoped as "reference implementation, not a production fabric" —
  this ADR narrows that gap without fully closing the larger one ADR-028 already defers (a real
  managed queue/broker fabric).

### Neutral

- Single-tenant or small fixed-tenant-count deployments can keep using `WORKER_TENANT_IDS` and
  skip this entirely; this ADR adds a better default, it does not remove the simpler option.

## Links

- [ADR-004](./ADR-004-use-transactional-outbox-and-durable-workflows.md)
- [ADR-011](./ADR-011-enforce-tenant-isolation-and-zero-trust-authorization.md)
- [ADR-028](./ADR-028-use-a-managed-durable-workflow-and-queue-fabric.md)
- [ADR-033](./ADR-033-wire-built-capabilities-into-the-runtime-path-with-fail-closed-defaults.md)
