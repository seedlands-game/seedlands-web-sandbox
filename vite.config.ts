import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.SEEDLANDS_BASE_PATH ?? '/',
  build: {
    manifest: true,
    rollupOptions: {
      output: {
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          if (id.includes('/node_modules/playcanvas/')) return 'playcanvas';
        },
      },
    },
  },
});
