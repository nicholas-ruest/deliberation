import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { PostgresReplayStore } from '../../src/platform/security/postgres-replay-store.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
const suite = databaseUrl === undefined ? describe.skip : describe;

suite('PostgresReplayStore', () => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const store = new PostgresReplayStore(pool);

  afterAll(async () => pool.end());

  it('accepts a token on first use and rejects the identical token on a second use', async () => {
    const tokenId = `test:${randomUUID()}`;
    const expiresAt = Math.floor(Date.now() / 1000) + 300;

    await expect(store.consume(tokenId, expiresAt)).resolves.toBe(true);
    await expect(store.consume(tokenId, expiresAt)).resolves.toBe(false);
  });

  it('treats distinct token ids as independent, even with the same expiry', async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 300;
    const first = `test:${randomUUID()}`;
    const second = `test:${randomUUID()}`;

    await expect(store.consume(first, expiresAt)).resolves.toBe(true);
    await expect(store.consume(second, expiresAt)).resolves.toBe(true);
  });

  it('is shared across independent store instances against the same database (multi-replica correctness)', async () => {
    const tokenId = `test:${randomUUID()}`;
    const expiresAt = Math.floor(Date.now() / 1000) + 300;
    const otherPool = new pg.Pool({ connectionString: databaseUrl });
    const otherReplica = new PostgresReplayStore(otherPool);
    try {
      await expect(store.consume(tokenId, expiresAt)).resolves.toBe(true);
      await expect(otherReplica.consume(tokenId, expiresAt)).resolves.toBe(false);
    } finally {
      await otherPool.end();
    }
  });
});
