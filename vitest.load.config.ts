import { defineConfig } from 'vitest/config';

/**
 * ADR-047's load/soak/chaos suite, run by `npm run test:load` rather than by the default
 * `vitest run` that `npm run quality` gates on. These tests spawn multiple real API and worker
 * processes against real Postgres, drive genuinely concurrent traffic and SIGKILL a worker
 * mid-relay, so they are minutes-scale and deliberately excluded from the fast per-PR sweep
 * (see the matching `exclude` in `vitest.config.ts`).
 */
export default defineConfig({
  test: {
    include: ['tests/load/**/*.test.ts'],
    // Each file owns real OS processes and fixed ports; running them in parallel would have
    // them contend for the same Postgres connection budget and blur the load measurement.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
