import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['changes/2026-09-06-node-dedicated-server/e2e/network-bootstrap-welcome-corpus.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    maxWorkers: 1,
  },
});
