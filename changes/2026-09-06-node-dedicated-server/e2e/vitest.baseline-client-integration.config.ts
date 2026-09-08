import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['changes/2026-09-06-node-dedicated-server/e2e/network-baseline-client-integration.test.ts'],
    environment: 'node',
    allowOnly: false,
    passWithNoTests: false,
  },
});
