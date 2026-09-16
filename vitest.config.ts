import { defineConfig } from 'vitest/config';

// Workspace convenience runner for the architecture freeze. Cross-layer and
// Classic behavior tests remain deferred until the Playbook is complete.
export default defineConfig({
  test: {
    projects: ['packages/kernel/vitest.config.ts', 'packages/stdlib/vitest.config.ts'],
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
