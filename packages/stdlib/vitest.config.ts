import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: new URL('../..', import.meta.url).pathname,
  test: {
    root: new URL('../..', import.meta.url).pathname,
    name: '@seedlands/stdlib',
    include: ['packages/stdlib/tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
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
