import { afterAll, bench, describe } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgenticowBranchMemoryAdapter, DeltaBranchMemory } from '../src/scenario-planning/infrastructure/branch-memory.js';

const scope = { tenantId: 'tenant', purpose: 'benchmark', treeId: 'tree', branchId: 'root', frozenInputHash: 'input' };

const benchmarkDirectory = mkdtempSync(join(tmpdir(), 'agenticow-bench-'));
afterAll(() => rmSync(benchmarkDirectory, { recursive: true, force: true }));

for (const [name, create] of [
  ['in-memory-delta-reference', () => new DeltaBranchMemory()],
  ['agenticow-0.2.4-native-adapter', () => new AgenticowBranchMemoryAdapter(benchmarkDirectory)],
] as const) {
  describe(name, () => {
    const memory = create();
    bench('create-write-read-diff-discard', async () => {
      await memory.create(scope);
      for (let index = 0; index < 100; index += 1) {
        await memory.write(scope, {
          key: `key-${index}`,
          value: Buffer.from(`value-${index}`),
          tombstone: false,
          provenanceReference: `evidence-${index}`,
        });
      }
      await memory.read(scope, 'key-50');
      await memory.diff(scope);
      await memory.discard(scope);
    }, { iterations: 100, warmupIterations: 10, time: 0, warmupTime: 0 });
  });
}
