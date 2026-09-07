import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  base: process.env.SEEDLANDS_BASE_PATH ?? '/',
  plugins: [svelte()],
  build: {
    rollupOptions: {
      input: {
        game: fileURLToPath(new URL('./index.html', import.meta.url)),
        assets: fileURLToPath(new URL('./asset-workbench.html', import.meta.url)),
      },
    },
  },
});
