import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  base: process.env.SEEDLANDS_BASE_PATH ?? '/',
  plugins: [svelte()],
  build: {
    manifest: true,
    rollupOptions: {
      output: {
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          if (id.includes('/node_modules/playcanvas/')) return 'vendor-playcanvas';
          if (id.includes('/node_modules/tone/')) return 'vendor-tone';
          if (id.includes('/node_modules/svelte/')) return 'vendor-svelte';
          if (id.includes('/node_modules/')) return 'vendor-common';
          return undefined;
        },
      },
    },
  },
});
