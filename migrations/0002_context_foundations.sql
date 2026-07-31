BEGIN;

CREATE OR REPLACE FUNCTION public.current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

DO $$
DECLARE context_schema text;
BEGIN
  FOREACH context_schema IN ARRAY ARRAY[
    'identity_access', 'deliberation', 'preferences', 'evidence',
    'scenario_planning', 'evaluation', 'governance', 'learning',
    'integrations', 'commercial_operations'
  ]
  LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I.aggregates (
        tenant_id uuid NOT NULL,
        aggregate_type text NOT NULL,
        aggregate_id uuid NOT NULL,
        version integer NOT NULL CHECK (version >= 0),
        state jsonb NOT NULL,
        classification text NOT NULL,
        retention_policy_id text NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (tenant_id, aggregate_type, aggregate_id)
      )', context_schema
    );
    EXECUTE format('ALTER TABLE %I.aggregates ENABLE ROW LEVEL SECURITY', context_schema);
    EXECUTE format('ALTER TABLE %I.aggregates FORCE ROW LEVEL SECURITY', context_schema);
    EXECUTE format(
      'DROP POLICY IF EXISTS tenant_isolation ON %I.aggregates;
       CREATE POLICY tenant_isolation ON %I.aggregates
       USING (tenant_id = public.current_tenant_id())
       WITH CHECK (tenant_id = public.current_tenant_id())', context_schema, context_schema
    );
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I.outbox (
        event_id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL,
        aggregate_id uuid NOT NULL,
        aggregate_version integer NOT NULL,
        event_type text NOT NULL,
        schema_version integer NOT NULL,
        envelope jsonb NOT NULL,
        recorded_at timestamptz NOT NULL,
        published_at timestamptz
      )', context_schema
    );
    EXECUTE format('ALTER TABLE %I.outbox ENABLE ROW LEVEL SECURITY', context_schema);
    EXECUTE format('ALTER TABLE %I.outbox FORCE ROW LEVEL SECURITY', context_schema);
    EXECUTE format(
      'DROP POLICY IF EXISTS tenant_isolation ON %I.outbox;
       CREATE POLICY tenant_isolation ON %I.outbox
       USING (tenant_id = public.current_tenant_id())
       WITH CHECK (tenant_id = public.current_tenant_id())', context_schema, context_schema
    );
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I.inbox (
        consumer_name text NOT NULL,
        event_id uuid NOT NULL,
        tenant_id uuid NOT NULL,
        processed_at timestamptz NOT NULL,
        PRIMARY KEY (consumer_name, event_id)
      )', context_schema
    );
    EXECUTE format('ALTER TABLE %I.inbox ENABLE ROW LEVEL SECURITY', context_schema);
    EXECUTE format('ALTER TABLE %I.inbox FORCE ROW LEVEL SECURITY', context_schema);
    EXECUTE format(
      'DROP POLICY IF EXISTS tenant_isolation ON %I.inbox;
       CREATE POLICY tenant_isolation ON %I.inbox
       USING (tenant_id = public.current_tenant_id())
       WITH CHECK (tenant_id = public.current_tenant_id())', context_schema, context_schema
    );
  END LOOP;
END $$;

COMMIT;
