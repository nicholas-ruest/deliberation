import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // ADR-047: load/soak/chaos deliberately does not block every PR. Unlike tests/architecture,
    // tests/contracts and tests/security — which have dedicated scripts but still run in the
    // default sweep because they are fast — these spawn multiple real processes, drive real
    // concurrent traffic and SIGKILL a worker mid-relay, so they run only via `npm run test:load`.
    exclude: [...configDefaults.exclude, 'tests/load/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/apps/**', '**/index.ts'],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
    testTimeout: 15_000,
  },
});
