import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    passWithNoTests: false,
    allowOnly: false,
    coverage: {
      provider: 'v8',
      all: true,
      include: ['packages/game-core/src/world/**/*.ts'],
      reporter: ['text', 'json-summary', 'lcov'],
      thresholds: {
        lines: 80,
      },
    },
  },
});
