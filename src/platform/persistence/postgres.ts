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

  async inTenantTransaction<T>(tenantId: string, operation: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
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
