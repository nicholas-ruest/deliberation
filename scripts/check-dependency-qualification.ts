import { execFile } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * ADR-041: maps a ProductionDependency qualification id (ADR-031) to the npm package name(s)
 * whose `npm audit` status gates it. Only dependencies actually installed via npm need an
 * entry here — RuLake (ADR-038) and RVM (ADR-040) have no npm package at all, and SynthLang
 * (ADR-039) runs as a separate Python sidecar this repository's own `npm audit` cannot see.
 * Add an entry whenever a new `ProductionDependency` is qualified against a real npm package.
 */
const DEPENDENCY_PACKAGE_REGISTRY: Readonly<Record<string, readonly string[]>> = {
  agentdb: ['agentdb'],
  'agentic-flow': ['agentic-flow'],
};

/**
 * ADR-042 path 2: a dependency currently flagged by `npm audit` is still allowed to be marked
 * eligible if — and only if — a valid, unexpired entry exists here, hand-maintained next to the
 * enforcement point itself (the same discipline `scripts/check-licenses.ts`'s
 * `missingLicenseExceptions` already uses). This is the enforced source of truth; a matching
 * `RiskAcceptance` on the actual `DependencyQualification` object
 * (`src/integrations/domain/entities/production-dependency.ts`) is the self-documenting
 * domain-level record — keeping the two in agreement is a review discipline, not something this
 * script can verify for you. Empty by default: no risk has been accepted for anything yet.
 */
const RISK_ACCEPTANCES: Readonly<Record<string, {
  readonly acceptedAdvisories: readonly string[];
  readonly approvedBy: string;
  readonly requestedBy: string;
  readonly expiresAt: string;
}>> = {};

interface AuditReport {
  readonly vulnerabilities?: Readonly<Record<string, unknown>>;
}

function riskAcceptanceRegistry(): Readonly<Record<string, { readonly approvedBy: string; readonly requestedBy: string; readonly expiresAt: string }>> {
  // Test-only override, mirroring DEPENDENCY_QUALIFICATION_FLAGGED_OVERRIDE: never used to grant
  // a real acceptance — RISK_ACCEPTANCES above is the only registry with real, live effect.
  const override = process.env['DEPENDENCY_QUALIFICATION_RISK_ACCEPTANCE_OVERRIDE'];
  if (override !== undefined) return JSON.parse(override) as ReturnType<typeof riskAcceptanceRegistry>;
  return RISK_ACCEPTANCES;
}

function hasValidRiskAcceptance(dependencyId: string, now: Date): boolean {
  const acceptance = riskAcceptanceRegistry()[dependencyId];
  if (acceptance === undefined) return false;
  if (acceptance.requestedBy === acceptance.approvedBy) return false;
  const expiresAt = new Date(acceptance.expiresAt);
  return Number.isFinite(expiresAt.getTime()) && expiresAt > now;
}

const markEligiblePattern = /\.markEligible\(\s*true\s*\)/;

async function flaggedPackageNames(): Promise<ReadonlySet<string>> {
  // Test-only override so this check's pass/fail behavior can be exercised deterministically
  // without depending on this repository's real, time-varying npm audit output.
  const override = process.env['DEPENDENCY_QUALIFICATION_FLAGGED_OVERRIDE'];
  if (override !== undefined) {
    return new Set(override.split(',').map((name) => name.trim()).filter((name) => name.length > 0));
  }
  // `npm audit` exits non-zero whenever it finds anything at or above --audit-level; run it
  // for its JSON report regardless of exit code, the same way `npm audit --json` is meant to be
  // consumed by tooling rather than treated as a pass/fail signal on its own.
  const { stdout } = await execFileAsync('npm', ['audit', '--json'], { maxBuffer: 64 * 1024 * 1024 }).catch(
    (error: { stdout?: string }) => ({ stdout: error.stdout ?? '{}' }),
  );
  const report = JSON.parse(stdout) as AuditReport;
  return new Set(Object.keys(report.vulnerabilities ?? {}));
}

async function walk(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory)) {
    const path = resolve(directory, entry);
    if ((await stat(path)).isDirectory()) result.push(...(await walk(path)));
    else result.push(path);
  }
  return result;
}

const flagged = await flaggedPackageNames();
const root = resolve(process.env['DEPENDENCY_QUALIFICATION_ROOT'] ?? 'src');
const files = (await walk(root)).filter((file) => file.endsWith('.ts'));
const violations: string[] = [];

const now = new Date();
for (const [dependencyId, packages] of Object.entries(DEPENDENCY_PACKAGE_REGISTRY)) {
  const stillFlagged = packages.filter((pkg) => flagged.has(pkg));
  if (stillFlagged.length === 0) continue;
  if (hasValidRiskAcceptance(dependencyId, now)) {
    console.log(`'${dependencyId}' is audit-flagged (${stillFlagged.join(', ')}) but has a valid risk acceptance on file (ADR-042) — not blocked.`);
    continue;
  }
  for (const file of files) {
    const contents = await readFile(file, 'utf8');
    if (contents.includes(`'${dependencyId}'`) && markEligiblePattern.test(contents)) {
      violations.push(
        `${relative('.', file)}: marks dependency '${dependencyId}' eligible while npm audit still flags ${stillFlagged.join(', ')}, `
        + `and no valid risk acceptance is recorded in RISK_ACCEPTANCES (ADR-041, ADR-042)`,
      );
    }
  }
}

if (violations.length > 0) {
  throw new Error(`Dependency qualification policy failed (ADR-041):\n${violations.join('\n')}`);
}
console.log(`Dependency qualification policy passed: no audit-flagged dependency marked eligible in ${files.length} source files.`);
