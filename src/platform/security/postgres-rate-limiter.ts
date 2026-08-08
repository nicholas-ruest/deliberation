import type { Pool } from 'pg';
import { contextRuntimeRole } from '../persistence/postgres.js';

const IDENTITY_ACCESS_ROLE = contextRuntimeRole('identity_access');

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly limit: number;
}

export interface RateLimiter {
  consume(bucketKey: string): Promise<RateLimitDecision>;
}

/**
 * Fixed-window counter, correct across any number of replicas because the window bump is one
 * atomic upsert against Postgres rather than in-process state (ADR-034 item 3, same reasoning as
 * PostgresReplayStore). Deliberately per-authenticated-principal, applied after identity
 * verification — pre-authentication/anonymous flooding protection belongs at the trusted edge
 * (ADR-029), which this repository does not operate.
 */
export class PostgresFixedWindowRateLimiter implements RateLimiter {
  constructor(
    private readonly pool: Pool,
    private readonly limitPerWindow: number,
    private readonly windowMs: number = 60_000,
  ) {}

  async consume(bucketKey: string): Promise<RateLimitDecision> {
    const windowStart = new Date(Math.floor(Date.now() / this.windowMs) * this.windowMs);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const setRoleSql = `SET LOCAL ROLE ${IDENTITY_ACCESS_ROLE}`;
      await client.query(setRoleSql);
      const result = await client.query<{ request_count: number }>(
        `INSERT INTO identity_access.rate_limit_counters (bucket_key, window_start, request_count)
         VALUES ($1, $2, 1)
         ON CONFLICT (bucket_key, window_start) DO UPDATE SET
           request_count = identity_access.rate_limit_counters.request_count + 1
         RETURNING request_count`,
        [bucketKey, windowStart],
      );
      if (Math.random() < 0.01) {
        await client.query("DELETE FROM identity_access.rate_limit_counters WHERE window_start < now() - interval '1 hour'");
      }
      await client.query('COMMIT');
      const count = result.rows[0]?.request_count ?? 0;
      return { allowed: count <= this.limitPerWindow, remaining: Math.max(0, this.limitPerWindow - count), limit: this.limitPerWindow };
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw cause;
    } finally {
      client.release();
    }
  }
}
