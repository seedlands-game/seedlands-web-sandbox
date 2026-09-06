import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  base: process.env.SEEDLANDS_BASE_PATH ?? '/',
  plugins: [svelte()],
});
