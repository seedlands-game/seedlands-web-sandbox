import { expect, test } from '@playwright/test';
import { startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

for (const seed of [
  'living-world-autonomy',
  'seedlands-shell-journey',
  'seedlands-regression',
  'seedlands-mvp-river',
  'seedlands-mvp-highland',
]) {
  test(`新世界 ${seed} 安全出生并保持存档落点`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await startHarnessWorld(page, seed);
    const ready = await waitForSnapshot(
      page,
      (s) => s.onGround && !s.colliding && s.generationQueue === 0 && s.meshingQueue === 0,
    );
    expect(ready.player[1]).toBeGreaterThan(0);
    await page.getByRole('button', { name: '暂停游戏', exact: true }).click();
    await page.getByRole('button', { name: '保存并返回主菜单' }).click();
    await page.getByRole('button', { name: '继续世界', exact: true }).click();
    const restored = await waitForSnapshot(page, (s) => s.onGround && !s.colliding);
    for (let axis = 0; axis < 3; axis++) expect(restored.player[axis]).toBeCloseTo(ready.player[axis], 1);
    expect(errors).toEqual([]);
  });
}
