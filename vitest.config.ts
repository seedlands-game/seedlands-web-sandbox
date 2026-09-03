import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    passWithNoTests: false,
    allowOnly: false,
    coverage: {
      provider: 'v8',
      all: true,
      include: ['src/world/voxel.ts', 'src/world/mesh.ts', 'src/world/storage.ts'],
      reporter: ['text', 'json-summary', 'lcov'],
      thresholds: {
        lines: 80,
      },
    },
  },
});
