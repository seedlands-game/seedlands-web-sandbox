import { defineConfig, type ViteDevServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFile } from 'node:fs/promises';
import {
  applyPrerenderedBasePath,
  ensureCriticalStylesheetBeforeModule,
  injectPrerenderedStartScreen,
} from './scripts/prerendered-start-screen.mjs';

const base = process.env.SEEDLANDS_BASE_PATH ?? '/';
let developmentServer: ViteDevServer | undefined;

export default defineConfig({
  base,
  plugins: [
    {
      name: 'seedlands-prerendered-start-screen',
      configureServer(server) {
        developmentServer = server;
      },
      transformIndexHtml: {
        order: 'pre',
        async handler(html) {
          const fragment = developmentServer
            ? (
                (await developmentServer.ssrLoadModule('/src/app/ui/prerender-entry.ts')) as {
                  renderPrerenderedStartScreen: (assetBase: string) => string;
                }
              ).renderPrerenderedStartScreen('/')
            : await readFile('src/app/ui/generated/prerendered-start-screen.html', 'utf8');
          return injectPrerenderedStartScreen(html, applyPrerenderedBasePath(fragment.trimEnd(), base));
        },
      },
    },
    svelte(),
    {
      name: 'seedlands-critical-css-order',
      enforce: 'post',
      transformIndexHtml: { order: 'post', handler: ensureCriticalStylesheetBeforeModule },
    },
  ],
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
