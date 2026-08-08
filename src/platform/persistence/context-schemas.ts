export const CONTEXT_SCHEMAS = [
  'identity_access', 'deliberation', 'preferences', 'evidence',
  'scenario_planning', 'evaluation', 'governance', 'learning',
  'integrations', 'commercial_operations',
] as const;

export type ContextSchema = typeof CONTEXT_SCHEMAS[number];

const known: ReadonlySet<string> = new Set(CONTEXT_SCHEMAS);

export function assertContextSchema(value: string): asserts value is ContextSchema {
  if (!known.has(value)) throw new Error(`Unknown bounded-context schema: ${value}`);
}
