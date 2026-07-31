BEGIN;

DO $$
DECLARE context_schema text;
DECLARE role_name text;
BEGIN
  FOREACH context_schema IN ARRAY ARRAY[
    'identity_access', 'deliberation', 'preferences', 'evidence',
    'scenario_planning', 'evaluation', 'governance', 'learning',
    'integrations', 'commercial_operations'
  ]
  LOOP
    role_name := 'deliberation_' || context_schema || '_runtime';
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT', role_name);
    END IF;
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', context_schema, role_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO %I', context_schema, role_name);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', context_schema, role_name);
  END LOOP;
END $$;

COMMIT;
