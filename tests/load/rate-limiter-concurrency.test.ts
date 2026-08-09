import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AUDIENCE,
  generateIssuerKeypair,
  identityClaims,
  laboratoryRequestBody,
  mintToken,
  postRun,
  startApi,
  trustedIssuersConfig,
  type ApiProcess,
} from '../security/api-process-harness.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
const suite = databaseUrl === undefined ? describe.skip : describe;

const trusted = generateIssuerKeypair();
const LIMIT_PER_MINUTE = 10;
const TOTAL_REQUESTS = 40;
const WINDOW_MS = 60_000;

const delay = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * `PostgresFixedWindowRateLimiter` buckets by `floor(now / 60s)`. A run that straddles a window
 * boundary would legitimately admit up to two windows' worth of requests, which would look like
 * a limiter failure. Starting only when the current window has ample time left removes that.
 */
async function waitForRoomInCurrentWindow(minimumRemainingMs: number): Promise<void> {
  const remaining = WINDOW_MS - (Date.now() % WINDOW_MS);
  if (remaining < minimumRemainingMs) await delay(remaining + 100);
}

suite('Rate limiting holds across replicas under real concurrency (ADR-034 item 3, ADR-047)', () => {
  let replicaA: ApiProcess;
  let replicaB: ApiProcess;
  let pool: pg.Pool;
  const tenantId = randomUUID();
  let statuses: { readonly replica: 'a' | 'b'; readonly status: number }[] = [];

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl });
    const environment = {
      NODE_ENV: 'production',
      DATABASE_URL: databaseUrl ?? '',
      IDENTITY_AUDIENCE: AUDIENCE,
      IDENTITY_TRUSTED_ISSUERS: trustedIssuersConfig(trusted.publicKeyPem),
      RATE_LIMIT_PER_PRINCIPAL_PER_MINUTE: String(LIMIT_PER_MINUTE),
    };
    // Two independent OS processes sharing one Postgres: exactly the deployment shape
    // api-deployment.yaml runs (3 replicas) and the one an in-process counter would fail.
    [replicaA, replicaB] = await Promise.all([startApi(environment), startApi(environment)]);

    // One principal — same tenant and same `sub`, so every request hits the same bucket key —
    // but a distinct `jti` per request, because replay protection is a separate control that
    // would otherwise reject the second use of a token before the limiter ever sees it.
    const principalClaims = identityClaims(tenantId);
    const tokens = Array.from({ length: TOTAL_REQUESTS }, () =>
      mintToken(trusted.privateKeyPem, { ...principalClaims, jti: randomUUID() }));

    await waitForRoomInCurrentWindow(30_000);

    statuses = await Promise.all(tokens.map(async (token, index) => {
      const replica = index % 2 === 0 ? 'a' : 'b';
      const baseUrl = replica === 'a' ? replicaA.baseUrl : replicaB.baseUrl;
      const response = await postRun(baseUrl, { authorization: `Bearer ${token}` }, laboratoryRequestBody(tenantId));
      return { replica, status: response.status } as const;
    }));
  }, 180_000);

  afterAll(async () => {
    await Promise.all([replicaA?.stop(), replicaB?.stop()]);
    if (pool !== undefined) {
      await pool.query('DELETE FROM deliberation.outbox WHERE tenant_id = $1', [tenantId]).catch(() => undefined);
      for (const schema of ['deliberation', 'scenario_planning', 'evaluation']) {
        await pool.query(`DELETE FROM ${schema}.aggregates WHERE tenant_id = $1`, [tenantId]).catch(() => undefined);
      }
      await pool.query('DELETE FROM identity_access.rate_limit_counters WHERE bucket_key LIKE $1', [`${tenantId}:%`]).catch(() => undefined);
      await pool.end();
    }
  });

  it('resolves every concurrent request as either accepted or rate-limited', () => {
    const unexpected = statuses.filter(({ status }) => status !== 201 && status !== 429);
    expect(unexpected).toEqual([]);
  });

  it('never admits more than the configured limit across both replicas combined', () => {
    const accepted = statuses.filter(({ status }) => status === 201);
    const byReplica = {
      a: accepted.filter(({ replica }) => replica === 'a').length,
      b: accepted.filter(({ replica }) => replica === 'b').length,
    };
    console.log(JSON.stringify({
      msg: 'load.rate_limiter_concurrency.result',
      totalRequests: TOTAL_REQUESTS,
      limitPerMinute: LIMIT_PER_MINUTE,
      accepted: accepted.length,
      rateLimited: statuses.length - accepted.length,
      byReplica,
    }));
    // A per-process counter would admit up to 2 x LIMIT here, so equality — not just the
    // inequality — is what discriminates a shared counter from a replicated one.
    expect(accepted.length).toBeLessThanOrEqual(LIMIT_PER_MINUTE);
    expect(accepted.length).toBe(LIMIT_PER_MINUTE);
  });

  it('records exactly one shared counter row for the principal, not one per replica', async () => {
    const counters = await pool.query<{ request_count: string }>(
      'SELECT request_count FROM identity_access.rate_limit_counters WHERE bucket_key LIKE $1',
      [`${tenantId}:%`],
    );
    expect(counters.rowCount).toBe(1);
    expect(Number(counters.rows[0]?.request_count)).toBe(TOTAL_REQUESTS);
  });
});
