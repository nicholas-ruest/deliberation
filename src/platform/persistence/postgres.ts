import { AsyncLocalStorage } from 'node:async_hooks';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

export interface TenantTransaction {
  readonly tenantId: string;
  readonly client: PoolClient;
}

export class PostgresUnitOfWork {
  private readonly context = new AsyncLocalStorage<TenantTransaction>();

  constructor(private readonly pool: Pool) {}

  current(): TenantTransaction {
    const transaction = this.context.getStore();
    if (transaction === undefined) throw new Error('No tenant transaction is active');
    return transaction;
  }

  /**
   * `runtimeRole`, when given, downgrades the session to that least-privilege role for the
   * duration of the transaction (`SET LOCAL ROLE`, reverted automatically at COMMIT/ROLLBACK).
   * This is what actually makes row-level security bind: FORCE ROW LEVEL SECURITY does not
   * apply to a superuser connection, and this pool is commonly configured with one (matching
   * how tests/component/postgres-rls.test.ts already exercises this). Omitting it preserves
   * the caller's existing connection privileges, for call sites that manage their own role.
   * The role name is validated against a closed identifier pattern before being interpolated —
   * SET ROLE has no bind-parameter form — never pass a request-derived value here.
   */
  async inTenantTransaction<T>(tenantId: string, operation: () => Promise<T>, runtimeRole?: string): Promise<T> {
    if (runtimeRole !== undefined && !/^[a-z][a-z0-9_]+$/.test(runtimeRole)) {
      throw new Error('Invalid runtime role name');
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (runtimeRole !== undefined) {
        const setRoleSql = `SET LOCAL ROLE ${runtimeRole}`;
        await client.query(setRoleSql);
      }
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const result = await this.context.run({ tenantId, client }, operation);
      await client.query('COMMIT');
      return result;
    } catch (cause) {
      await client.query('ROLLBACK');
      throw cause;
    } finally {
      client.release();
    }
  }

  async query<T extends QueryResultRow>(sql: string, values: readonly unknown[] = []): Promise<readonly T[]> {
    const transaction = this.current();
    if (!sql.includes('tenant_id')) throw new Error('Tenant-owned query lacks tenant predicate');
    const result = await transaction.client.query<T>(sql, [...values]);
    return result.rows;
  }
}

export function contextRuntimeRole(context: string): string {
  if (!/^[a-z][a-z0-9_]+$/.test(context)) throw new Error('Invalid context role name');
  return `deliberation_${context}_runtime`;
}
