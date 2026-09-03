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
const macroMapOnly = process.argv.includes('--macro-map-only');
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
  if (macroMapOnly) {
    await page.locator('#map-toggle').click();
    await page.locator('#macro-map-panel').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForFunction(() => document.querySelector('#macro-map-panel')?.getAttribute('data-status') === 'ready', undefined, { timeout: 20000 });
    await page.locator('#map-layer').selectOption('hydrology');
    await page.waitForFunction(() => document.querySelector('#macro-map-panel')?.getAttribute('data-status') === 'ready', undefined, { timeout: 20000 });
    const macroMapResult = { browserMacroMap: { status: 'PASS', stages: { load: stages.load, macroMap: 'PASS' } } };
    const resultDir = new URL('../harness/results/', import.meta.url);
    await mkdir(resultDir, { recursive: true });
    await writeFile(new URL('macro-map-e2e.json', resultDir), `${JSON.stringify(macroMapResult, null, 2)}\n`);
    console.log(JSON.stringify(macroMapResult, null, 2));
    await browser.close(); await server.close(); process.exit(0);
  }

  await page.locator('#game').click({ position: { x: 640, y: 360 } });
  await page.waitForFunction(() => document.pointerLockElement?.id === 'game', undefined, { timeout: 5000 });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(850);
  await page.keyboard.up('KeyW');
  await page.waitForFunction(() => window.__seedlandsHarness?.snapshot().onGround === true, undefined, { timeout: 5000 });
  const beforeJump = await page.evaluate(() => window.__seedlandsHarness?.snapshot());
  await page.keyboard.down('Space');
  await page.waitForTimeout(80);
  await page.keyboard.up('Space');
  await page.waitForFunction((y) => (window.__seedlandsHarness?.snapshot().player[1] ?? 0) > y + .3, beforeJump.player[1], { timeout: 1000 });
  await page.waitForFunction(() => window.__seedlandsHarness?.snapshot().onGround === true, undefined, { timeout: 3000 });
  const afterInput = await page.evaluate(() => window.__seedlandsHarness?.snapshot());
  assert.ok(afterInput && Math.abs(afterInput.player[2]) > 0.5, 'Input: forward movement did not change player position');
  stages.input = 'PASS';
  stages.player = 'PASS';

  await page.evaluate(() => window.__seedlandsHarness?.prepareFlatMovement());
  const beforeFlatMovement = await page.evaluate(() => window.__seedlandsHarness?.snapshot());
  assert.equal(beforeFlatMovement?.colliding, false, 'Player: standing on a flat voxel platform must not overlap its floor');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(850);
  await page.keyboard.up('KeyW');
  await page.waitForFunction(() => window.__seedlandsHarness?.snapshot().onGround === true, undefined, { timeout: 3000 });
  const afterFlatMovement = await page.evaluate(() => window.__seedlandsHarness?.snapshot());
  assert.ok(afterFlatMovement && Math.abs(afterFlatMovement.player[2] - beforeFlatMovement.player[2]) > 3, `Player: movement on a flat voxel platform was blocked (${JSON.stringify({ beforeFlatMovement, afterFlatMovement })})`);
  assert.ok(Math.abs(afterFlatMovement.player[1] - beforeFlatMovement.player[1]) < .01, 'Player: flat movement changed the grounded camera height');
  stages.flatMovement = 'PASS';

  await page.evaluate(() => window.__seedlandsHarness?.preparePartialSupport());
  const beforePartialSupport = await page.evaluate(() => window.__seedlandsHarness?.snapshot());
  await page.waitForFunction((y) => (window.__seedlandsHarness?.snapshot().player[1] ?? Infinity) < y - .5, beforePartialSupport.player[1], { timeout: 1000 });
  const afterPartialSupport = await page.evaluate(() => window.__seedlandsHarness?.snapshot());
  assert.equal(afterPartialSupport?.onGround, false, 'Player: a single footprint corner must not count as ground support');
  await page.keyboard.down('Space');
  await page.waitForTimeout(120);
  await page.keyboard.up('Space');
  const afterAirJump = await page.evaluate(() => window.__seedlandsHarness?.snapshot());
  assert.ok(afterAirJump && afterAirJump.player[1] < afterPartialSupport.player[1], 'Player: jump must not re-arm while falling from partial support');
  stages.partialSupport = 'PASS';

  await page.mouse.move(640, 640);
  await page.waitForTimeout(150);
  await page.mouse.click(640, 360, { button: 'left' });
  await page.waitForFunction(() => (window.__seedlandsHarness?.snapshot().mutationCount ?? 0) >= 1, undefined, { timeout: 5000 });
  const saveAfterBreak = await page.evaluate(() => localStorage.getItem('seedlands-world-v2'));
  await page.mouse.click(640, 360, { button: 'right' });
  await page.waitForFunction((previous) => localStorage.getItem('seedlands-world-v2') !== null && localStorage.getItem('seedlands-world-v2') !== previous, saveAfterBreak, { timeout: 5000 });
  const beforeBurst = await page.evaluate(() => window.__seedlandsHarness?.snapshot());
  await page.evaluate(() => window.__seedlandsHarness?.burstEdits());
  await page.waitForFunction(() => (window.__seedlandsHarness?.snapshot().deferredRemeshes ?? 0) > 0, undefined, { timeout: 1000 });
  await page.waitForFunction((count) => (window.__seedlandsHarness?.snapshot().mutationCount ?? 0) > count, beforeBurst.mutationCount, { timeout: 5000 });
  await page.waitForFunction(() => (window.__seedlandsHarness?.snapshot().deferredRemeshes ?? 0) === 0, undefined, { timeout: 5000 });
  const afterEdit = await page.evaluate(() => window.__seedlandsHarness?.snapshot());
  assert.ok(afterEdit.storageBytes > 0, 'Persistence: edit did not save a world payload');
  stages.interaction = 'PASS';

  const beforeStream = await page.evaluate(() => window.__seedlandsHarness?.snapshot());
  await page.evaluate((x) => window.__seedlandsHarness?.moveTo(x, 0), beforeStream.player[0] + 40);
  await page.waitForFunction((x) => (window.__seedlandsHarness?.snapshot().player[0] ?? 0) > x, beforeStream.player[0] + 30, { timeout: 5000 });
  await page.waitForTimeout(500);
  await page.waitForFunction(() => (window.__seedlandsHarness?.snapshot().loadedChunks ?? 0) > 0, undefined, { timeout: 10000 });
  stages.streaming = 'PASS';

  await page.keyboard.press('KeyM');
  await page.locator('#macro-map-panel').waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForFunction(() => document.querySelector('#macro-map-panel')?.getAttribute('data-status') === 'ready', undefined, { timeout: 20000 });
  await page.locator('#map-layer').selectOption('hydrology');
  await page.waitForFunction(() => document.querySelector('#macro-map-panel')?.getAttribute('data-status') === 'ready', undefined, { timeout: 20000 });
  const mapPixels = await page.locator('#macro-map').evaluate((canvas) => {
    const context = (canvas instanceof HTMLCanvasElement ? canvas : null)?.getContext('2d');
    return context?.getImageData(0, 0, 1, 1).data[3] ?? 0;
  });
  assert.equal(mapPixels, 255, 'Macro map: expected sampled canvas pixels');
  stages.macroMap = 'PASS';

  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#enter').click();
  await page.locator('#debug').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForFunction((count) => (window.__seedlandsHarness?.snapshot().mutationCount ?? 0) === count, afterEdit.mutationCount, { timeout: 15000 });
  stages.persistence = 'PASS';
  const browserResult = { browserE2E: { status: 'PASS', stages } };
  const browserResultDir = new URL('../harness/results/', import.meta.url);
  await mkdir(browserResultDir, { recursive: true });
  await writeFile(new URL('browser-e2e.json', browserResultDir), `${JSON.stringify(browserResult, null, 2)}\n`);
  console.log(JSON.stringify(browserResult, null, 2));
} catch (error) {
  throw new Error(`${error instanceof Error ? error.message : String(error)}\nPage errors: ${pageErrors.join(' | ') || 'none'}`, { cause: error });
} finally {
  await browser.close();
  await server.close();
}
