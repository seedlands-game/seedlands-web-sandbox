import { defineConfig } from 'vitest/config';

/** 仅用于本 change 的真实 Host corpus 准出，不纳入长期 Vitest 基线发现。 */
export default defineConfig({
  test: {
    include: ['changes/2026-09-06-node-dedicated-server/e2e/network-real-corpus-recorder.test.ts'],
    exclude: ['**/node_modules/**', '**/.git/**'],
  },
});
