import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'changes/2026-09-06-node-dedicated-server/e2e/network-baseline-scheduler.test.ts',
      'changes/2026-09-06-node-dedicated-server/e2e/network-complete-baseline-worker.test.ts',
      'changes/2026-09-06-node-dedicated-server/e2e/network-reference-receiver.test.ts',
      'changes/2026-09-06-node-dedicated-server/e2e/network-worker-input-settlement.test.ts',
    ],
    environment: 'node',
    globals: false,
    passWithNoTests: false,
    allowOnly: false,
  },
});
