import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve('migrations');
let files: string[] = [];
try {
  files = await walk(root);
} catch {
  console.log('No migrations yet; migration check passed for Prompt 01.');
  process.exit(0);
}

const unsafe = /\b(DROP\s+(?:TABLE|COLUMN)|TRUNCATE|ALTER\s+COLUMN.+TYPE)\b/i;
const violations: string[] = [];
for (const file of files.filter((name) => name.endsWith('.sql'))) {
  const sql = await readFile(file, 'utf8');
  if (unsafe.test(sql)) violations.push(file);
}
if (violations.length > 0) {
  throw new Error(`Destructive migrations are forbidden in release source; use separately approved expand/contract phases:\n${violations.join('\n')}`);
}
console.log(`Migration check passed for ${files.length} files.`);

async function walk(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory)) {
    const path = resolve(directory, entry);
    if ((await stat(path)).isDirectory()) result.push(...await walk(path));
    else result.push(path);
  }
  return result;
}
