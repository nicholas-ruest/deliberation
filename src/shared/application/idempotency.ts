import { createHash } from 'node:crypto';
import type { Result } from '../domain/result.js';

interface RecordEntry<T> {
  readonly requestHash: string;
  readonly result: Result<T>;
  readonly expiresAt: number;
}

export class IdempotencyStore {
  private readonly records = new Map<string, RecordEntry<unknown>>();

  execute<T>(
    scope: string,
    key: string,
    request: unknown,
    now: Date,
    ttlMs: number,
    operation: () => Result<T>,
  ): Result<T> {
    this.prune(now);
    const scopedKey = `${scope}:${key}`;
    const requestHash = canonicalHash(request);
    const existing = this.records.get(scopedKey);
    if (existing !== undefined) {
      if (existing.requestHash !== requestHash) {
        return {
          ok: false,
          error: { code: 'IDEMPOTENCY_CONFLICT', message: 'Idempotency key was used with a different request' },
        };
      }
      return existing.result as Result<T>;
    }
    const result = operation();
    this.records.set(scopedKey, { requestHash, result, expiresAt: now.getTime() + ttlMs });
    return result;
  }

  private prune(now: Date): void {
    for (const [key, value] of this.records) {
      if (value.expiresAt <= now.getTime()) this.records.delete(key);
    }
  }
}

export function canonicalHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
