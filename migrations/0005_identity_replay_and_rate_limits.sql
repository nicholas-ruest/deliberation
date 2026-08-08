BEGIN;

-- Replay protection and per-principal rate limiting are identity-and-access concerns (ADR-034),
-- not tenant-scoped business data: a forged or replayed token's tenant claim cannot be trusted,
-- so these tables are keyed on the token/principal identifier itself and carry no RLS policy.
-- Grants reuse the existing deliberation_identity_access_runtime role from migration 0003.

CREATE TABLE IF NOT EXISTS identity_access.consumed_identity_tokens (
  token_key text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS consumed_identity_tokens_expires_at_idx
  ON identity_access.consumed_identity_tokens (expires_at);

CREATE TABLE IF NOT EXISTS identity_access.rate_limit_counters (
  bucket_key text NOT NULL,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, window_start)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON identity_access.consumed_identity_tokens TO deliberation_identity_access_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON identity_access.rate_limit_counters TO deliberation_identity_access_runtime;

COMMIT;
