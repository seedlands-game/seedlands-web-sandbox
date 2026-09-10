import { expect, test } from '@playwright/test';
import { startHarnessWorld } from '../../../tests/e2e/support/harness';

test('真实 Browser Worker 校验 ESM Pack 并往返组合身份检查点', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.log('PACK_STARTUP_PAGE_ERROR', error.message);
  });
  page.on('console', (message) => {
    if (message.type() === 'error')
      console.log('PACK_STARTUP_CONSOLE_ERROR', message.text().slice(0, 1500), message.location());
  });
  const assets: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 400) console.log('PACK_STARTUP_HTTP_ERROR', response.status(), response.url());
    if (response.url().includes('/packs/')) assets.push(new URL(response.url()).pathname);
  });
  await startHarnessWorld(page, 'composed-pack-startup');
  const result = await page.evaluate(async () => {
    const world = window.__seedlandsHarness!.world;
    await world.clock({ kind: 'pause' });
    const exported = await world.checkpoint({ kind: 'export' });
    if (!exported.ok || !exported.data.snapshot)
      throw new Error(`Checkpoint export failed: ${JSON.stringify(exported)}`);
    const checkpoint = exported.data.snapshot;
    const restored = await world.checkpoint({ kind: 'restore', snapshot: checkpoint });
    const after = await world.checkpoint({ kind: 'export' });
    if (!after.ok || !after.data.snapshot) throw new Error('Restored checkpoint export failed.');
    return { composition: checkpoint.gameplay.composition, after: after.data.snapshot.gameplay.composition, restored };
  });
  expect(result.composition?.playbookId).toBe('seedlands:overworld');
  expect(result.composition?.packLock[0]?.integrity.entryDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(result.restored.ok).toBe(true);
  expect(result.after).toEqual(result.composition);
  expect(assets.some((path) => path.endsWith('/packs.lock.json'))).toBe(true);
  expect(assets.some((path) => path.endsWith('/overworld.mjs'))).toBe(true);
  expect(errors).toEqual([]);
});

test('篡改 ESM 字节时启动明确失败', async ({ page }) => {
  test.setTimeout(45_000);
  await page.route('**/packs/overworld.mjs', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n// tampered\n` });
  });
  await page.goto('./?harness=1');
  await page.locator('#seed').fill('composed-pack-invalid');
  await page.getByRole('button', { name: '进入世界' }).click();
  const warning = page.getByRole('button', { name: '仍然进入' });
  if (await warning.isVisible()) await warning.click();
  await expect(page.getByText(/Pack digest mismatch/)).toBeVisible({ timeout: 30_000 });
});
