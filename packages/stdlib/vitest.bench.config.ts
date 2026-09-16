import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    root: new URL('../..', import.meta.url).pathname,
    include: ['packages/stdlib/benchmarks/**/*.test.ts'],
    passWithNoTests: false,
    allowOnly: false,
    maxWorkers: 1,
    testTimeout: 120000,
  },
});
