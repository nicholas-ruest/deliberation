import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { PostgresFixedWindowRateLimiter } from '../../src/platform/security/postgres-rate-limiter.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
const suite = databaseUrl === undefined ? describe.skip : describe;

suite('PostgresFixedWindowRateLimiter', () => {
  const pool = new pg.Pool({ connectionString: databaseUrl });

  afterAll(async () => pool.end());

  it('allows requests up to the ceiling and denies the request that exceeds it', async () => {
    const limiter = new PostgresFixedWindowRateLimiter(pool, 3, 60_000);
    const bucketKey = `test:${randomUUID()}`;

    for (let index = 0; index < 3; index += 1) {
      const decision = await limiter.consume(bucketKey);
      expect(decision.allowed).toBe(true);
      expect(decision.limit).toBe(3);
    }

    const denied = await limiter.consume(bucketKey);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
  });

  it('tracks independent buckets separately', async () => {
    const limiter = new PostgresFixedWindowRateLimiter(pool, 1, 60_000);
    const bucketA = `test:${randomUUID()}`;
    const bucketB = `test:${randomUUID()}`;

    await expect(limiter.consume(bucketA)).resolves.toMatchObject({ allowed: true });
    await expect(limiter.consume(bucketA)).resolves.toMatchObject({ allowed: false });
    await expect(limiter.consume(bucketB)).resolves.toMatchObject({ allowed: true });
  });

  it('reports decreasing remaining count as the window fills', async () => {
    const limiter = new PostgresFixedWindowRateLimiter(pool, 5, 60_000);
    const bucketKey = `test:${randomUUID()}`;

    const first = await limiter.consume(bucketKey);
    const second = await limiter.consume(bucketKey);
    expect(first.remaining).toBe(4);
    expect(second.remaining).toBe(3);
  });
});
