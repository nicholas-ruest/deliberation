BEGIN;

-- The decision-laboratory HTTP handler (src/apps/api.ts) is an explicit composition root
-- (see docs/adr/ADR-002 and scripts/check-architecture.ts's isCompositionRoot allowance for
-- platform/laboratory/ and apps/): one request commits deliberation, scenario-planning, and
-- evaluation aggregates plus one outbox event in a single transaction, rather than coordinating
-- three separate per-context sagas. That single transaction still needs to run under a
-- least-privilege role for row-level security to bind (see ADR-033) — this role's grants are the
-- union of exactly the three context schemas that composition touches, nothing more.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'deliberation_laboratory_runtime') THEN
    CREATE ROLE deliberation_laboratory_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;

DO $$
DECLARE context_schema text;
BEGIN
  FOREACH context_schema IN ARRAY ARRAY['deliberation', 'scenario_planning', 'evaluation']
  LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO deliberation_laboratory_runtime', context_schema);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO deliberation_laboratory_runtime', context_schema);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO deliberation_laboratory_runtime', context_schema);
  END LOOP;
END $$;

COMMIT;
