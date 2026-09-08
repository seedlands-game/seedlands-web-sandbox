import { expect, test } from '@playwright/test';
import { startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';
const probes = '/changes/2026-09-08-asset-appearance-center/e2e/render-probes.ts';
test('灯笼MVP：同页编辑、草稿、应用、刷新与恢复', async ({ page, context }, info) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/asset-workbench.html');
  await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeEnabled();
  await expect(page.locator('.viewport')).toHaveAttribute('data-ready', 'true');
  const source = 'seedlands:texture/terrain/lantern-frame';
  const before = await page.evaluate(
    async (path) => ((await import(path)) as typeof import('./render-probes')).snapshot(),
    probes,
  );
  await page.getByLabel('灯笼框架材质 粗糙度').fill('0.25');
  await page.getByRole('button', { name: '编辑贴图：灯笼框架贴图' }).click();
  await page.getByRole('button', { name: '扩展至 32 × 32' }).click();
  await page.getByRole('button', { name: '扩展至 64 × 64' }).click();
  await page.locator('.palette button').nth(4).click();
  const canvas = page.getByLabel('像素画布，方向键移动，空格绘制');
  await canvas.focus();
  await canvas.press('Space');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText('草稿已保存到此浏览器，游戏外观尚未改变。')).toBeVisible();
  const saved = await page.evaluate(
    async (path) => ((await import(path)) as typeof import('./render-probes')).snapshot(),
    probes,
  );
  expect(saved.applied).toEqual(before.applied);
  expect(saved.draft.assets.find((asset) => asset.id === source)?.type).toBe('pixel-texture');
  await page.getByRole('button', { name: '应用到游戏', exact: true }).click();
  await expect(page.getByText(/已应用外观快照/)).toBeVisible({ timeout: 20_000 });
  const applied = await page.evaluate(
    async (path) => ((await import(path)) as typeof import('./render-probes')).snapshot(),
    probes,
  );
  expect(applied.applied.assets).toEqual(saved.draft.assets);
  expect(applied.thumbnailSizes).toEqual(Array.from({ length: 10 }, () => [512, 512]));
  const game = await context.newPage();
  game.on('pageerror', (error) => errors.push(error.message));
  await startHarnessWorld(game, 'mosslight-68');
  await waitForSnapshot(game, (state) => state.renderedChunks > 0 && state.onGround);
  await game.evaluate(async () => {
    const h = window.__seedlandsHarness!;
    await h.fillWorld({ from: [-4, 57, -2], to: [4, 57, 3], voxel: 3 });
    await h.fillWorld({ from: [-4, 58, -2], to: [4, 63, 3], voxel: 0 });
    await h.setVoxelAt(0, 58, 0, 10);
    await h.executeGameplayCommand({ type: 'give-item', itemId: 'lantern', count: 1 });
    await h.executeGameplayCommand({ type: 'spawn-world-item', itemId: 'lantern', count: 1, position: [2, 58.5, 0] });
    await h.setWorldTime(10);
    h.setTimePaused(true);
    h.setSpectatorPosition(0.5, 59.3, 4);
    h.setView(0, -10);
  });
  await game.keyboard.press('KeyE');
  const slotIndex = Number(await game.getByRole('gridcell', { name: '灯笼 1', exact: true }).getAttribute('data-slot'));
  await game.getByRole('button', { name: '关闭背包', exact: true }).click();
  await game.keyboard.press(`Digit${slotIndex + 1}`);
  await expect
    .poll(() =>
      game.evaluate(async (path) => ((await import(path)) as typeof import('./render-probes')).gameMaterials(), probes),
    )
    .toEqual({ framePixel: [209, 167, 106, 255], frameWidth: 64, worldGloss: 0.75, itemGloss: 0.75 });
  const iconSize = await game
    .locator('#hotbar .item-icon')
    .first()
    .evaluate(async (element) => {
      const image = element as HTMLImageElement;
      await image.decode();
      return image.naturalWidth;
    });
  expect(iconSize).toBe(512);
  await waitForSnapshot(game, (state) => state.meshingQueue === 0 && state.generationQueue === 0);
  await game.keyboard.press('F3');
  await game.screenshot({ path: info.outputPath('lantern-game-applied.png') });
  await game.close();
  await page.reload();
  await expect(page.getByLabel('灯笼框架材质 粗糙度')).toHaveValue('0.25');
  for (const name of ['模型', '放置', '手持', '掉落']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('.viewport')).toHaveAttribute('data-ready', 'true');
    await page.screenshot({ path: info.outputPath(`lantern-${name}.png`) });
  }
  await page.getByRole('button', { name: '恢复上一个应用版本', exact: true }).click();
  await expect(page.getByText(/已恢复上一个已应用外观/)).toBeVisible();
  const restored = await page.evaluate(
    async (path) => ((await import(path)) as typeof import('./render-probes')).snapshot(),
    probes,
  );
  expect(restored.applied).toEqual(before.applied);
  expect(errors).toEqual([]);
});
