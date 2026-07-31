import { readdir, readFile, stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

const root = resolve(process.env['ARCHITECTURE_ROOT'] ?? 'src');
const files = await walk(root);
const violations: string[] = [];

for (const file of files.filter((candidate) => candidate.endsWith('.ts'))) {
  const source = await readFile(file, 'utf8');
  const rel = relative(root, file).replaceAll('\\', '/');
  const [context, layer] = rel.split('/');
  const isCompositionRoot = rel.startsWith('platform/laboratory/') || rel.startsWith('apps/');

  if (layer === 'domain' && /from ['"][^'"]*infrastructure/.test(source)) {
    violations.push(`${rel}: domain imports infrastructure`);
  }
  if (rel.endsWith('/index.ts') && rel.split('/').length === 2 && /infrastructure/.test(source)) {
    violations.push(`${rel}: public context API exports infrastructure`);
  }
  for (const match of source.matchAll(/from ['"](?:\.\.\/){2,}([^/'"]+)/g)) {
    const importedContext = match[1];
    if (!isCompositionRoot && context !== undefined && importedContext !== undefined && importedContext !== context && importedContext !== 'shared' && importedContext !== 'platform') {
      violations.push(`${rel}: direct cross-context implementation import to ${importedContext}`);
    }
  }
}

if (violations.length > 0) {
  throw new Error(`Architecture violations:\n${violations.join('\n')}`);
}
console.log(`Architecture check passed for ${files.length} source files.`);

async function walk(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory)) {
    const path = resolve(directory, entry);
    if ((await stat(path)).isDirectory()) result.push(...await walk(path));
    else result.push(path);
  }
  return result;
}
