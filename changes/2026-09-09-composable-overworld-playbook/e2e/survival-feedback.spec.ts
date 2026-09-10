import { expect, test } from '@playwright/test';
import { startHarnessWorld, lockPointer, moveHarnessPlayer, setHarnessView } from '../../../tests/e2e/support/harness';

test('实际采食和背包食用更新饥饿 HUD，死亡提示可复活并拾回掉落', async ({ page }, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startHarnessWorld(page, 'browser-survival-feedback');
  await page.evaluate(async () => {
    const h = window.__seedlandsHarness!;
    await h.world.logic({ kind: 'mode', mode: 'scripted' });
    await h.fillWorld({ from: [-2, 59, -2], to: [3, 59, 4], voxel: 3 });
    await h.fillWorld({ from: [-2, 60, -2], to: [3, 64, 4], voxel: 0 });
    await h.setVoxelAt(0, 60, 0, 5);
    await h.setVoxelAt(1, 60, 0, 5);
  });
  for (const x of [0, 1]) {
    await lockPointer(page);
    await page.mouse.move(0, 0);
    await moveHarnessPlayer(page, x + 0.5, 61.6, 2.5);
    await setHarnessView(page, 0, -28.81);
    await expect(page.locator('#target-card[data-voxel="5"]')).toBeVisible();
    await page.mouse.down();
    try {
      await expect.poll(() => page.evaluate((x) => window.__seedlandsHarness!.getVoxelAt!(x, 60, 0), x)).toBe(0);
    } finally {
      await page.mouse.up();
    }
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(470);
    await page.keyboard.up('KeyW');
  }
  await page.evaluate(async () => {
    const world = window.__seedlandsHarness!.world;
    await world.clock({ kind: 'pause' });
    for (let step = 0; step < 2; step++) {
      const result = await world.clock({ kind: 'advance', elapsedMs: 60000 });
      if (!result.ok) throw new Error(JSON.stringify(result));
    }
    await world.clock({ kind: 'run' });
  });
  await expect(page.getByRole('meter', { name: '饥饿', exact: true })).toHaveAttribute('aria-valuenow', '19');
  await page.keyboard.press('KeyE');
  const berries = page.getByRole('grid', { name: '背包槽位', exact: true }).locator('[data-item="berry"]');
  const cursor = page.locator('[data-inventory-cursor]');
  await expect(berries).toHaveAttribute('data-count', '2');
  await expect(cursor).toHaveCount(0);
  await berries.hover();
  const eat = page.getByRole('button', { name: '食用浆果', exact: true });
  await expect(eat).toBeEnabled();
  await eat.click();
  await expect(berries).toHaveAttribute('data-count', '1');
  await expect(cursor).toHaveCount(0);
  await expect(page.getByRole('meter', { name: '饥饿', exact: true })).toHaveAttribute('aria-valuenow', '20');
  await page.screenshot({ path: info.outputPath('food-and-hunger.png') });
  await page.getByRole('button', { name: '关闭背包', exact: true }).click();
  // 本项使用可控伤害触发 HUD；普通 NPC 致死和庇护阻挡由两日 Headless 旅程独立验证。
  expect(
    await page.evaluate(() => window.__seedlandsHarness!.world.command({ type: 'apply-damage', amount: 20 })),
  ).toMatchObject({ ok: true, data: { success: true } });
  await expect(page.getByRole('dialog', { name: '你倒下了', exact: true })).toBeVisible();
  await expect(page.getByText('背包物品已掉落在倒下的位置。复活后可以重新找回。', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('death-and-recovery.png') });
  await page.getByRole('button', { name: '复活', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '你倒下了', exact: true })).toBeHidden();
  await moveHarnessPlayer(page, 1.5, 61.6, 0.5);
  await lockPointer(page);
  await expect(page.getByRole('button', { name: '选择浆果 1', exact: true })).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('KeyE');
  await expect(berries).toHaveAttribute('data-count', '1');
  expect(errors).toEqual([]);
});
