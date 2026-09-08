import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

test('三包集成保留外观编辑、应用、游戏启动和公开资产', async ({ page, context }, info) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('asset-workbench.html');
  await expect(page.locator('.viewport')).toHaveAttribute('data-ready', 'true');
  await page.getByLabel('灯笼框架材质 粗糙度').fill('0.25');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText('草稿已保存到此浏览器，游戏外观尚未改变。')).toBeVisible();
  await page.getByRole('button', { name: '应用到游戏', exact: true }).click();
  await expect(page.getByText(/已应用外观快照/)).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await expect(page.getByLabel('灯笼框架材质 粗糙度')).toHaveValue('0.25');
  await expect(page.locator('.viewport')).toHaveAttribute('data-ready', 'true');
  await page.screenshot({ path: info.outputPath('asset-workbench.png') });
  expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();

  const game = await context.newPage();
  game.on('pageerror', (error) => errors.push(error.message));
  await startHarnessWorld(game, 'mosslight-68');
  await waitForSnapshot(game, (state) => state.renderedChunks > 0 && state.onGround);
  await game.evaluate(async () => {
    await window.__seedlandsHarness!.executeGameplayCommand({ type: 'give-item', itemId: 'lantern', count: 1 });
  });
  await expect(game.locator('#hotbar .item-icon').first()).toBeVisible();
  const iconWidth = await game
    .locator('#hotbar .item-icon')
    .first()
    .evaluate(async (element) => {
      const image = element as HTMLImageElement;
      await image.decode();
      return image.naturalWidth;
    });
  expect(iconWidth).toBe(512);
  await game.screenshot({ path: info.outputPath('game-after-appearance-apply.png') });
  const glb = await page.request.get(new URL('assets/samples/brass-trail-lantern.glb', page.url()).href);
  expect(glb.ok()).toBe(true);
  expect((await glb.body()).subarray(0, 4).toString()).toBe('glTF');
  expect(errors).toEqual([]);
});

test('三包集成保留静态GLB导入与刷新预览', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('asset-workbench.html');
  await expect(page.locator('.viewport')).toHaveAttribute('data-ready', 'true');
  const buffer = await readFile(new URL('../../../apps/web/public/assets/samples/static-crate.glb', import.meta.url));
  await page.getByLabel('导入静态 GLB', { exact: true }).setInputFiles({
    name: '三包木箱.glb',
    mimeType: 'model/gltf-binary',
    buffer,
  });
  await expect(page.getByRole('heading', { name: '三包木箱.glb', level: 1, exact: true })).toBeVisible();
  await expect(page.locator('.viewport')).toHaveAttribute('data-ready', 'true');
  await page.reload();
  await page.getByRole('button', { name: /三包木箱.glb/ }).click();
  await expect(page.locator('.viewport')).toHaveAttribute('data-ready', 'true');
  await page.screenshot({ path: info.outputPath('glb-after-reload.png') });
  expect(errors).toEqual([]);
});
