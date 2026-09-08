import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Run against this checkout's Vite development server. The browser creates isolated,
// empty project state; existing browser drafts and world saves are never opened.
const root = fileURLToPath(new URL('../../', import.meta.url));
const options = new Map(process.argv.slice(2).map((argument) => argument.split('=')));
if (options.has('--help')) {
  console.log('node scripts/assets/render-item-thumbnails.mjs --url=http://127.0.0.1:5173/ [--output=directory]');
  process.exit(0);
}
const url = new URL(options.get('--url') ?? 'http://127.0.0.1:5173/');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
  throw new Error('Thumbnail generation requires a local Vite server.');
const output = path.resolve(root, options.get('--output') ?? 'apps/web/public/assets/item-thumbnails');
const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath = process.env.SEEDLANDS_CHROME_PATH ?? (existsSync(systemChrome) ? systemChrome : undefined);
const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const entry = new URL('thumbnail-render.html', url).href;
  await page.route(entry, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head><link rel="icon" href="data:,"></head><body></body></html>',
    }),
  );
  await page.goto(entry);
  const result = await page.evaluate(async (base) => {
    const { renderAppearanceThumbnails } = await import(`${base}src/app/asset-workbench/appearance-thumbnails.ts`);
    const { createEmptyAppearanceProject } = await import(`${base}src/client/presentation/appearance-project.ts`);
    return renderAppearanceThumbnails(createEmptyAppearanceProject());
  }, url.href);
  if (errors.length) throw new Error(errors.join('\n'));
  await mkdir(output, { recursive: true });
  for (const [id, dataUrl] of Object.entries(result)) {
    const item = id.replace('builtin:model:', '');
    if (!/^[a-z0-9-]+$/.test(item)) throw new Error('Unexpected item identifier');
    await writeFile(path.join(output, `${item}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
  }
  console.log(`Rendered ${Object.keys(result).length} engine thumbnails at 512×512 → ${output}`);
} finally {
  await browser.close();
}
