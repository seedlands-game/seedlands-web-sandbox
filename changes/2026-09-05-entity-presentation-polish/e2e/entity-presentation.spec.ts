import { expect, test } from '@playwright/test';
import { startHarnessWorld } from '../../../tests/e2e/support/harness';

test('自然实体标签避开暂停入口，存退不残留世界标签', async ({ page }) => {
  await startHarnessWorld(page, 'mosslight');
  for (const width of [1280, 700]) {
    await page.setViewportSize({ width, height: 720 });
    const pause = await page.getByRole('button', { name: '暂停游戏', exact: true }).boundingBox();
    const badges = await page.locator('#presented-entity-semantics').boundingBox();
    expect(badges!.y).toBeGreaterThanOrEqual(pause!.y + pause!.height + 8);
  }
  await page.getByRole('button', { name: '暂停游戏', exact: true }).click();
  await page.getByRole('button', { name: '保存并返回主菜单' }).click();
  await expect(page.getByRole('img', { name: '营地居民', exact: true })).toHaveCount(0);
});
