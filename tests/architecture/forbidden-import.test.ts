import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('architecture enforcement', () => {
  it('rejects a domain-to-infrastructure import fixture', () => {
    const result = spawnSync(process.execPath, [
      '--import', 'tsx', 'scripts/check-architecture.ts',
    ], {
      cwd: process.cwd(),
      env: { ...process.env, ARCHITECTURE_ROOT: 'tests/fixtures/forbidden' },
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('domain imports infrastructure');
  });
});
