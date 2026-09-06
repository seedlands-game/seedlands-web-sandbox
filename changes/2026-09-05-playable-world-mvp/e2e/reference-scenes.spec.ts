import { expect, test } from '@playwright/test';
import { macroAt } from '../../../src/world/macro-world';
import { normalizeSeed } from '../../../src/world/voxel';
import { waitForSnapshot } from '../../../tests/e2e/support/harness';

test('林地、真实河岸与有光营地的昼暮夜参考镜头', async ({ page }, testInfo) => {
  test.skip(process.env.SEEDLANDS_VISUAL_ACCEPTANCE !== '1', '完整视觉矩阵须显式执行。');
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const place of ['forest', 'river', 'camp'] as const) {
    const seedText = place === 'camp' ? 'living-world-autonomy' : 'mosslight-68';
    await page.goto('./?harness=1');
    await page.locator('#quality').selectOption('high');
    await page.locator('#seed').fill(seedText);
    await page.getByRole('button', { name: '进入世界', exact: true }).click();
    const initial = await waitForSnapshot(page, (s) => s.onGround && !s.colliding);
    await page.keyboard.press('F3');
    if (place === 'river') {
      const water = macroAt(normalizeSeed(seedText), 32, -32).hydrology;
      expect(water.water).toBe(true);
      await page.evaluate((level) => {
        const api = window.__seedlandsHarness!;
        api.setSpectatorPosition(25, level + 5, -22);
        api.setView(-35, -23);
      }, water.waterLevel! + 1);
    } else if (place === 'camp') {
      const y = Math.floor(initial.player[1] - 1.6);
      await page.evaluate((y) => {
        const api = window.__seedlandsHarness!;
        api.setVoxelAt(6, y, 4, 9);
        api.setSpectatorPosition(3, y + 2.7, 9);
        api.setView(-45, -14);
      }, y);
    }
    for (const [phase, hour] of [
      ['day', 10],
      ['dusk', 17.5],
      ['night', 23],
    ] as const) {
      await page.evaluate((hour) => {
        window.__seedlandsHarness!.setWorldTime(hour);
        window.__seedlandsHarness!.setTimePaused(true);
      }, hour);
      await expect(page.locator('#world-clock')).toContainText(hour === 17.5 ? '17:30' : `${hour}:00`);
      const state = await waitForSnapshot(
        page,
        (s) =>
          s.generationQueue === 0 &&
          s.meshingQueue === 0 &&
          s.performance.uploadQueueDepth === 0 &&
          s.renderedChunks > 4,
      );
      if (place === 'river') expect(state.visualEffects.reflectionActive).toBe(true);
      if (place === 'camp') expect(state.visualEffects.activeLocalLights).toBe(1);
      await page.screenshot({ path: testInfo.outputPath(`${place}-${phase}.png`) });
      await testInfo.attach(`${place}-${phase}-state`, {
        body: JSON.stringify(state),
        contentType: 'application/json',
      });
    }
    await page.getByRole('button', { name: '暂停游戏', exact: true }).click();
    await page.getByRole('button', { name: '保存并返回主菜单' }).click();
  }
  expect(errors).toEqual([]);
});
