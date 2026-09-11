import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: new URL('../..', import.meta.url).pathname,
  test: {
    root: new URL('../..', import.meta.url).pathname,
    name: '@seedlands/playbook-classic',
    include: ['playbooks/classic/tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    passWithNoTests: false,
    allowOnly: false,
  },
});
