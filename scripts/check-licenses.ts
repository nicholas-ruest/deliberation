import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const denied = /\b(?:AGPL|GPL)(?:-|$)/i;

/**
 * Exceptions for packages whose own `package.json` omits a `license` field but whose actual
 * license was verified by hand against the package's own committed LICENSE file (or the
 * upstream repository's declared license) and is not itself denied. This is not a blanket
 * bypass — each entry names the verified license and how it was checked, so a reviewer can
 * confirm the claim independently instead of trusting the exception.
 */
const missingLicenseExceptions: ReadonlyMap<string, { readonly verifiedLicense: string; readonly checkedVia: string }> = new Map([
  ['pipenet@1.4.2', {
    verifiedLicense: 'MIT',
    checkedVia: 'node_modules/pipenet/LICENSE (committed MIT license text, Copyright Frank Fiegel) and '
      + 'GitHub repository metadata (punkpeye/pipenet). Transitive via agentic-flow -> fastmcp -> '
      + 'mcp-proxy (ADR-036); the code path this platform actually imports (agentic-flow/router/cost-optimal) '
      + 'does not use pipenet, but npm installs the whole package\'s dependency tree regardless.',
  }],
]);

const missing: string[] = [];
const violations: string[] = [];
const appliedExceptions = new Set<string>();
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
      const exception = missingLicenseExceptions.get(identity);
      if (license === undefined || license.length === 0) {
        if (exception === undefined) missing.push(identity);
        else appliedExceptions.add(identity);
      } else if (denied.test(license)) {
        violations.push(`${identity}: ${license}`);
      }
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
for (const identity of appliedExceptions) {
  const exception = missingLicenseExceptions.get(identity);
  console.log(`Applied missing-license exception for ${identity}: verified ${exception?.verifiedLicense} (${exception?.checkedVia})`);
}
console.log('Dependency license policy passed (no GPL/AGPL or missing declarations).');
