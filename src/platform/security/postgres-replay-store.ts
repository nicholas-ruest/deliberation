import type { Pool } from 'pg';
import { contextRuntimeRole } from '../persistence/postgres.js';
import type { ReplayStore } from './trusted-identity.js';

const IDENTITY_ACCESS_ROLE = contextRuntimeRole('identity_access');

/**
 * Shared, replica-safe replay protection (ADR-034): first-use detection is a single atomic
 * `INSERT ... ON CONFLICT DO NOTHING`, so uniqueness is enforced by Postgres itself rather than
 * by in-process locking that only one replica would ever see. A token/jti pair carries no tenant
 * claim that can be trusted before verification succeeds, so this table has no RLS policy — the
 * `SET LOCAL ROLE` downgrade below is least-privilege defense in depth, not a tenant boundary.
 */
export class PostgresReplayStore implements ReplayStore {
  constructor(private readonly pool: Pool) {}

  async consume(tokenId: string, expiresAt: number): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const setRoleSql = `SET LOCAL ROLE ${IDENTITY_ACCESS_ROLE}`;
      await client.query(setRoleSql);
      const result = await client.query(
        `INSERT INTO identity_access.consumed_identity_tokens (token_key, expires_at, consumed_at)
         VALUES ($1, to_timestamp($2), now())
         ON CONFLICT (token_key) DO NOTHING
         RETURNING token_key`,
        [tokenId, expiresAt],
      );
      // Opportunistic cleanup, sampled rather than run every call, so a hot path never pays for a
      // table scan: this table only grows from legitimate identity-token traffic.
      if (Math.random() < 0.01) {
        await client.query("DELETE FROM identity_access.consumed_identity_tokens WHERE expires_at < now() - interval '1 hour'");
      }
      await client.query('COMMIT');
      return result.rowCount === 1;
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw cause;
    } finally {
      client.release();
    }
  }
}
