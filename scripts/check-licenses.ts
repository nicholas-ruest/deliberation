import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const denied = /\b(?:AGPL|GPL)(?:-|$)/i;
const missing: string[] = [];
const violations: string[] = [];
for (const name of await readdir(resolve('node_modules'))) {
  if (name.startsWith('.')) continue;
  const packageDirectories = name.startsWith('@')
    ? (await readdir(resolve('node_modules', name))).map((child) => resolve('node_modules', name, child))
    : [resolve('node_modules', name)];
  for (const directory of packageDirectories) {
    try {
      const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8')) as {
        name?: string;
        version?: string;
        license?: string;
        licenses?: readonly { type?: string }[];
      };
      const license = manifest.license ?? manifest.licenses?.map(({ type }) => type).filter(Boolean).join(' OR ');
      const identity = `${manifest.name ?? directory}@${manifest.version ?? 'unknown'}`;
      if (license === undefined || license.length === 0) missing.push(identity);
      else if (denied.test(license)) violations.push(`${identity}: ${license}`);
    } catch {
      // Directories without a package manifest are not dependency packages.
    }
  }
}
if (violations.length > 0 || missing.length > 0) {
  throw new Error([
    ...violations.map((value) => `Denied license ${value}`),
    ...missing.map((value) => `Missing license ${value}`),
  ].join('\n'));
}
console.log('Dependency license policy passed (no GPL/AGPL or missing declarations).');
