import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.SEEDLANDS_BASE_PATH ?? '/',
});
