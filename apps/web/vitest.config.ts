import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  root: new URL('../..', import.meta.url).pathname,
  plugins: [svelte()],
  test: {
    root: new URL('../..', import.meta.url).pathname,
    name: '@seedlands/web',
    include: ['apps/web/tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    passWithNoTests: false,
    allowOnly: false,
  },
});
