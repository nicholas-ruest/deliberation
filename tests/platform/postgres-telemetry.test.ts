import { describe, expect, it, vi } from 'vitest';
import { context, metrics, trace } from '@opentelemetry/api';
import type { Pool, PoolClient } from 'pg';
import { PostgresUnitOfWork, contextRuntimeRole } from '../../src/platform/persistence/index.js';
import { Telemetry, evaluateSli, safeAttributes } from '../../src/platform/observability/index.js';

describe('Postgres unit of work', () => {
  it('sets tenant context, commits successful work and exposes the current client', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('SELECT value')) return { rows: [{ value: 1 }] };
      return { rows: [] };
    });
    const client = { query, release: vi.fn() } as unknown as PoolClient;
    const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
    const unit = new PostgresUnitOfWork(pool);
    await expect(unit.inTenantTransaction('tenant', async () => {
      expect(unit.current().tenantId).toBe('tenant');
      return unit.query<{ value: number }>('SELECT value FROM table WHERE tenant_id = $1', ['tenant']);
    })).resolves.toEqual([{ value: 1 }]);
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      "SELECT set_config('app.tenant_id', $1, true)",
      'SELECT value FROM table WHERE tenant_id = $1',
      'COMMIT',
    ]);
    expect((client.release as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it('rolls back failures and rejects unscoped queries/current access', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const client = { query, release: vi.fn() } as unknown as PoolClient;
    const unit = new PostgresUnitOfWork({ connect: async () => client } as unknown as Pool);
    expect(() => unit.current()).toThrow();
    await expect(unit.inTenantTransaction('tenant', async () => {
      await expect(unit.query('SELECT * FROM table')).rejects.toThrow('tenant predicate');
      throw new Error('failure');
    })).rejects.toThrow('failure');
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(contextRuntimeRole('identity_access')).toBe('deliberation_identity_access_runtime');
    expect(() => contextRuntimeRole('../unsafe')).toThrow();
  });
});

describe('telemetry behavior', () => {
  it('allows only bounded low-cardinality attributes', () => {
    expect(safeAttributes({
      service: 'api', version: '1', environment: 'test', region: 'eu',
      operation: 'case.create', outcome: 'success', risk_tier: 'low',
    })).toEqual({
      service: 'api', version: '1', environment: 'test', region: 'eu',
      operation: 'case.create', outcome: 'success', risk_tier: 'low',
    });
    expect(() => safeAttributes({ service: 'password=super-secret-value' })).toThrow();
    expect(() => safeAttributes({ service: 'x'.repeat(121) })).toThrow();
  });

  it('records success and failure spans without leaking work payloads', async () => {
    const end = vi.fn();
    const setStatus = vi.fn();
    vi.spyOn(trace, 'getTracer').mockReturnValue({
      startActiveSpan: (_name: string, _options: unknown, _context: unknown, callback: (span: unknown) => unknown) =>
        callback({ end, setStatus }),
    } as never);
    vi.spyOn(metrics, 'getMeter').mockReturnValue({
      createCounter: () => ({ add: vi.fn() }),
      createHistogram: () => ({ record: vi.fn() }),
    } as never);
    vi.spyOn(context, 'active').mockReturnValue({} as never);
    const telemetry = new Telemetry();
    await expect(telemetry.operation('success', { operation: 'test' }, async () => 42)).resolves.toBe(42);
    await expect(telemetry.operation('failure', { operation: 'test' }, async () => { throw new Error('failed'); })).rejects.toThrow();
    expect(end).toHaveBeenCalledTimes(2);
    expect(setStatus).toHaveBeenCalledTimes(2);
  });

  it('handles empty and failing SLI windows', () => {
    expect(evaluateSli({ total: 0, good: 0, latenciesMs: [] }, 0.999)).toEqual({
      availability: 1, meetsObjective: true,
    });
    const failed = evaluateSli({ total: 10, good: 8, latenciesMs: [1, 1000] }, 0.9, 100);
    expect(failed.meetsObjective).toBe(false);
    expect(failed.p95).toBe(1000);
  });
});
