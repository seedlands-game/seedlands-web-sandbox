import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { build } from 'vite';
import { PRERENDER_BASE_PLACEHOLDER, validatePrerenderedStartScreen } from './prerendered-start-screen.mjs';

const outputPath = resolve('src/app/ui/generated/prerendered-start-screen.html');
const mode = process.argv[2];
if (mode !== '--write' && mode !== '--check')
  throw new Error('Usage: render-prerendered-start-screen.mjs --write|--check');

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'seedlands-prerender-'));
try {
  await build({
    base: PRERENDER_BASE_PLACEHOLDER,
    configFile: false,
    logLevel: 'error',
    plugins: [svelte()],
    build: {
      ssr: resolve('src/app/ui/prerender-entry.ts'),
      outDir: temporaryDirectory,
      emptyOutDir: true,
      rollupOptions: { output: { entryFileNames: 'entry.mjs' } },
    },
  });
  const renderer = await import(pathToFileURL(join(temporaryDirectory, 'entry.mjs')).href);
  const fragment = `${validatePrerenderedStartScreen(renderer.renderPrerenderedStartScreen())}\n`;
  if (mode === '--write') {
    await writeFile(outputPath, fragment);
  } else {
    const committed = await readFile(outputPath, 'utf8');
    if (committed !== fragment) throw new Error('Prerendered start screen is stale. Run pnpm ssg:update.');
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
