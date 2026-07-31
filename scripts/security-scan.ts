import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, relative } from 'node:path';

interface Rule {
  readonly id: string;
  readonly pattern: RegExp;
  readonly message: string;
}

const rules: readonly Rule[] = [
  { id: 'dynamic-code', pattern: /\b(?:eval|Function)\s*\(/, message: 'Dynamic code execution is forbidden' },
  { id: 'shell-execution', pattern: /from ['"]node:child_process['"]|require\(['"]child_process['"]\)/, message: 'Shell execution requires an approved isolated adapter' },
  { id: 'hardcoded-private-key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, message: 'Private key material found' },
  { id: 'hardcoded-secret', pattern: /\b(?:api[_-]?key|password|client[_-]?secret)\s*[:=]\s*['"][^'"]{8,}['"]/i, message: 'Potential hardcoded secret found' },
  { id: 'unsafe-sql-template', pattern: /\.(?:query|execute)\s*\(\s*`[^`]*\$\{/, message: 'Interpolated SQL is forbidden' },
  { id: 'path-traversal', pattern: /\b(?:readFile|writeFile|open)\s*\([^)]*req(?:uest)?\./, message: 'Unvalidated request-derived file path' },
];

const files = await walk(resolve('src'));
const findings: string[] = [];
for (const file of files.filter((candidate) => candidate.endsWith('.ts'))) {
  const source = await readFile(file, 'utf8');
  for (const rule of rules) {
    if (rule.pattern.test(source)) findings.push(`${relative('.', file)} [${rule.id}] ${rule.message}`);
  }
}
if (findings.length > 0) throw new Error(`Security scan failed:\n${findings.join('\n')}`);
console.log(`Security scan passed ${rules.length} rules across ${files.length} source files.`);

async function walk(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory)) {
    const path = resolve(directory, entry);
    if ((await stat(path)).isDirectory()) result.push(...await walk(path));
    else result.push(path);
  }
  return result;
}
