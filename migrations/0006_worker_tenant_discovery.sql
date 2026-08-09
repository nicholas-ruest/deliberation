BEGIN;

-- ADR-049: lets the worker discover which tenants to relay for, instead of requiring an operator
-- to maintain WORKER_TENANT_IDS by hand. This is a narrow, single-purpose privilege escalation,
-- not a general cross-tenant read: the function returns only tenant IDs for active Tenant
-- aggregates, nothing else, and the role permitted to call it can do nothing but call it.
--
-- SECURITY DEFINER functions run as their owner; identity_access.aggregates has
-- FORCE ROW LEVEL SECURITY (migration 0002), so this only bypasses tenant scoping if its owner
-- can itself bypass RLS (the privileged role migrations already run as) — the same precondition
-- the existing public.current_tenant_id() SECURITY DEFINER function (migration 0002) already
-- relies on, not a new privilege model introduced here.
CREATE OR REPLACE FUNCTION identity_access.list_active_tenant_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = identity_access, pg_catalog
AS $$
  SELECT aggregate_id
  FROM identity_access.aggregates
  WHERE aggregate_type = 'Tenant'
    AND state ->> 'state' = 'active'
$$;

REVOKE ALL ON FUNCTION identity_access.list_active_tenant_ids() FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'deliberation_worker_discovery_runtime') THEN
    CREATE ROLE deliberation_worker_discovery_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;

-- EXECUTE on this one function only. No SELECT/INSERT/UPDATE/DELETE grant on any table, and no
-- grant on any other context's schema — this role cannot read tenant data, only enumerate IDs.
GRANT USAGE ON SCHEMA identity_access TO deliberation_worker_discovery_runtime;
GRANT EXECUTE ON FUNCTION identity_access.list_active_tenant_ids() TO deliberation_worker_discovery_runtime;

COMMIT;
