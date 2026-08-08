import { describe, expect, it } from 'vitest';
import { assertContextSchema, CONTEXT_SCHEMAS } from '../../src/platform/persistence/context-schemas.js';

describe('context schemas', () => {
  it('accepts every known bounded-context schema name', () => {
    for (const schema of CONTEXT_SCHEMAS) expect(() => assertContextSchema(schema)).not.toThrow();
  });

  it('rejects an unknown schema name', () => {
    expect(() => assertContextSchema('not_a_schema')).toThrow(/Unknown bounded-context schema/);
  });
});
