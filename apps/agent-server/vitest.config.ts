import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: new URL('../..', import.meta.url).pathname,
  test: {
    root: new URL('../..', import.meta.url).pathname,
    name: '@seedlands/agent-server',
    include: ['apps/agent-server/tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    passWithNoTests: false,
    allowOnly: false,
  },
});
