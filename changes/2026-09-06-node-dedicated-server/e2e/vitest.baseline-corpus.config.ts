import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['changes/2026-09-06-node-dedicated-server/e2e/network-baseline-corpus.test.ts'],
    exclude: ['**/node_modules/**', '**/.git/**'],
  },
});
