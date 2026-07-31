import { access, readFile } from 'node:fs/promises';

const expected = new Set([
  'context-schema-ownership', 'immutable-published-artifacts', 'stronger-than-model-verification',
  'credential-reference-only', 'bounded-reserved-execution', 'observed-outcomes-only-learning',
  'server-side-authorization', 'governed-erasure', 'mesh-requires-adr', 'immutable-versioned-configuration',
  'audited-break-glass', 'tenant-prefiltered-retrieval', 'canonical-domain-truth',
]);
const registry = JSON.parse(await readFile('config/operations/prohibited-shortcuts.json', 'utf8')) as {
  schemaVersion: number;
  controls: { id: string; mode: 'automated' | 'review'; evidence: string }[];
};
if (registry.schemaVersion !== 1) throw new Error('Unsupported shortcut-control registry version');
const seen = new Set<string>();
for (const control of registry.controls) {
  if (!expected.has(control.id) || seen.has(control.id) || !['automated', 'review'].includes(control.mode)) {
    throw new Error(`Invalid or duplicate shortcut control: ${control.id}`);
  }
  await access(control.evidence);
  seen.add(control.id);
}
const missing = [...expected].filter((id) => !seen.has(id));
if (missing.length > 0) throw new Error(`Prohibited shortcuts lack controls: ${missing.join(', ')}`);
console.log(`Validated ${seen.size} prohibited-shortcut controls.`);
