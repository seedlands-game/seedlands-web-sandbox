import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const cliEntry = require.resolve('@midscene/cli');
const playwrightEntry = require.resolve('playwright', { paths: [cliEntry] });
const playwright = await import(playwrightEntry);
const { chromium } = playwright.default ?? playwright;
const server = await createServer({ server: { host: '127.0.0.1' } });
await server.listen();
const address = server.resolvedUrls?.local[0];
if (!address) throw new Error('Load: Vite did not report a local URL');

const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath = process.env.SEEDLANDS_CHROME_PATH ?? await access(systemChrome).then(() => systemChrome).catch(() => undefined);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const stages = {};
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') pageErrors.push(message.text()); });
try {
  await page.goto(`${address}?harness=1`, { waitUntil: 'networkidle' });
  await page.locator('#seed').fill('seedlands-harness-e2e');
  await page.locator('#enter').click();
  await page.waitForTimeout(250);
  const startState = await page.evaluate(() => ({ startHidden: document.querySelector('#start-card')?.hasAttribute('hidden'), hudHidden: document.querySelector('#hud')?.hasAttribute('hidden') }));
  if (!startState.startHidden || startState.hudHidden) throw new Error(`Load: enter action did not start the game: ${JSON.stringify(startState)}`);
  await page.locator('#debug').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => window.__seedlandsHarness?.snapshot().loadedChunks > 0, undefined, { timeout: 15000 });
  stages.load = 'PASS';

  await page.locator('#game').click({ position: { x: 640, y: 360 } });
  await page.waitForFunction(() => document.pointerLockElement?.id === 'game', undefined, { timeout: 5000 });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(850);
  await page.keyboard.up('KeyW');
  await page.keyboard.press('Space');
  const afterInput = await page.evaluate(() => window.__seedlandsHarness?.snapshot());
  assert.ok(afterInput && Math.abs(afterInput.player[2]) > 0.5, 'Input: forward movement did not change player position');
  stages.input = 'PASS';
  stages.player = 'PASS';

  await page.mouse.move(640, 640);
  await page.waitForTimeout(150);
  await page.mouse.click(640, 360, { button: 'left' });
  await page.waitForFunction(() => (window.__seedlandsHarness?.snapshot().mutationCount ?? 0) === 1, undefined, { timeout: 5000 });
  await page.mouse.click(640, 360, { button: 'right' });
  await page.waitForFunction(() => (window.__seedlandsHarness?.snapshot().mutationCount ?? 0) === 2, undefined, { timeout: 5000 });
  const afterEdit = await page.evaluate(() => window.__seedlandsHarness?.snapshot());
  assert.ok(afterEdit.storageBytes > 0, 'Persistence: edit did not save a world payload');
  stages.interaction = 'PASS';

  await page.keyboard.down('KeyD');
  await page.waitForTimeout(5600);
  await page.keyboard.up('KeyD');
  await page.waitForFunction(() => (window.__seedlandsHarness?.snapshot().loadedChunks ?? 0) > 0, undefined, { timeout: 10000 });
  stages.streaming = 'PASS';

  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#enter').click();
  await page.locator('#debug').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => (window.__seedlandsHarness?.snapshot().mutationCount ?? 0) === 2, undefined, { timeout: 15000 });
  stages.persistence = 'PASS';
} catch (error) {
  throw new Error(`${error instanceof Error ? error.message : String(error)}\nPage errors: ${pageErrors.join(' | ') || 'none'}`, { cause: error });
} finally {
  await browser.close();
  await server.close();
}

const browserResult = { browserE2E: { status: 'PASS', stages } };
const browserResultDir = new URL('../harness/results/', import.meta.url);
await mkdir(browserResultDir, { recursive: true });
await writeFile(new URL('browser-e2e.json', browserResultDir), `${JSON.stringify(browserResult, null, 2)}\n`);
console.log(JSON.stringify(browserResult, null, 2));
