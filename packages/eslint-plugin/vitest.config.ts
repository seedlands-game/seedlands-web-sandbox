import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: new URL('.', import.meta.url).pathname,
    passWithNoTests: false,
    allowOnly: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
