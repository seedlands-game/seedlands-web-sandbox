import { expect, test } from '@playwright/test';
import { lockPointer, snapshot, startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

for (const seed of [
  'living-world-autonomy',
  'seedlands-shell-journey',
  'seedlands-regression',
  'seedlands-mvp-river',
  'seedlands-mvp-highland',
]) {
  test(`新世界 ${seed} 安全出生、实际取得材料并保持存档落点`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await startHarnessWorld(page, seed);
    const ready = await waitForSnapshot(
      page,
      (s) => s.onGround && !s.colliding && s.generationQueue === 0 && s.meshingQueue === 0,
    );
    expect(ready.player[1]).toBeGreaterThan(0);
    await lockPointer(page);
    await page.evaluate(() => window.__seedlandsHarness!.setView(0, -89));
    const revision = ready.worldRevision;
    await page.mouse.down();
    try {
      await expect.poll(async () => (await snapshot(page))!.worldRevision).toBeGreaterThan(revision);
    } finally {
      await page.mouse.up();
    }
    await expect.poll(async () => (await snapshot(page))!.player[1]).toBeLessThan(ready.player[1] - 0.5);
    await waitForSnapshot(page, (s) => s.onGround && !s.colliding);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(180); // 受控短步输入，拾取结果由背包断言。
    await page.keyboard.up('KeyW');
    await page.keyboard.press('KeyE');
    const inventory = page.getByRole('dialog', { name: '背包与合成', exact: true });
    await expect(inventory.getByRole('gridcell', { name: /^(泥土块|石块|沙块|雪块) [1-9]/ })).toBeVisible();
    await page.getByRole('button', { name: '关闭背包', exact: true }).click();
    const savedPosition = (await snapshot(page))!.player;
    await page.getByRole('button', { name: '暂停游戏', exact: true }).click();
    await page.getByRole('button', { name: '保存并返回主菜单' }).click();
    await page.getByRole('button', { name: '继续世界', exact: true }).click();
    const restored = await waitForSnapshot(page, (s) => s.onGround && !s.colliding);
    for (let axis = 0; axis < 3; axis++) expect(restored.player[axis]).toBeCloseTo(savedPosition[axis], 1);
    expect(errors).toEqual([]);
  });
}
