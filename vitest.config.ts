import { defineConfig } from 'vitest/config';

// Workspace convenience runner. Rule tests have an independent package entrypoint.
export default defineConfig({
  test: {
    projects: [
      'packages/kernel/vitest.config.ts',
      'packages/stdlib/vitest.config.ts',
      'apps/web/vitest.config.ts',
      'apps/agent-server/vitest.config.ts',
      'playbooks/classic/vitest.config.ts',
    ],
    passWithNoTests: false,
    allowOnly: false,
    coverage: {
      provider: 'v8',
      include: ['packages/stdlib/src/world/**/*.ts'],
      reporter: ['text', 'json-summary', 'lcov'],
      thresholds: { lines: 80 },
    },
  },
});
