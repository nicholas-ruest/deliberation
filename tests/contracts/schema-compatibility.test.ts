import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('additive event compatibility', () => {
  it('keeps v1 required fields and allows additive optional fields', async () => {
    const schema = JSON.parse(await readFile('contracts/json-schema/v1/integration-event.schema.json', 'utf8')) as {
      required: string[];
      additionalProperties: boolean;
    };
    expect(schema.additionalProperties).toBe(true);
    expect(schema.required).toEqual(expect.arrayContaining([
      'eventId', 'eventType', 'schemaVersion', 'tenantId', 'aggregateId', 'aggregateVersion', 'payload',
    ]));
  });
});
