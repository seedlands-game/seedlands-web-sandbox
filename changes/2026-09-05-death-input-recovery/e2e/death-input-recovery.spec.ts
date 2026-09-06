import { expect, test } from '@playwright/test';
import { lockPointer, snapshot, startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

test('锁鼠行走死亡释放输入，背包死亡独占覆盖层并可复活', async ({ page }) => {
  await startHarnessWorld(page, 'living-world-autonomy');
  await lockPointer(page);
  await page.keyboard.down('KeyW');
  await page.evaluate(() => window.__seedlandsHarness!.executeGameplayCommand({ type: 'apply-damage', amount: 20 }));
  const death = page.getByRole('dialog', { name: '你倒下了', exact: true });
  await expect(death).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.pointerLockElement === null)).toBe(true);
  await death.getByRole('button', { name: '复活', exact: true }).click();
  await expect(death).toBeHidden();
  const restored = await waitForSnapshot(page, (s) => s.onGround && !s.colliding);
  await expect(page.getByRole('dialog', { name: '暂停游戏', exact: true })).toBeHidden();
  // 再次捕获前，保持W未keyup，验证生产releaseInput已经清空按键状态。
  await lockPointer(page);
  await page.waitForTimeout(300);
  expect(
    Math.hypot(
      (await snapshot(page))!.player[0] - restored.player[0],
      (await snapshot(page))!.player[2] - restored.player[2],
    ),
  ).toBeLessThan(0.05);
  await page.keyboard.up('KeyW');
  await page.keyboard.press('KeyE');
  await expect(page.getByRole('dialog', { name: '背包与合成', exact: true })).toBeVisible();
  await page.evaluate(() => window.__seedlandsHarness!.executeGameplayCommand({ type: 'apply-damage', amount: 20 }));
  await expect(death).toBeVisible();
  await expect(page.getByRole('dialog', { name: '背包与合成', exact: true })).toBeHidden();
  await death.getByRole('button', { name: '复活', exact: true }).click();
  await expect(death).toBeHidden();
  await lockPointer(page);
  await page.keyboard.down('KeyW');
  await expect
    .poll(async () =>
      Math.hypot(
        (await snapshot(page))!.player[0] - restored.player[0],
        (await snapshot(page))!.player[2] - restored.player[2],
      ),
    )
    .toBeGreaterThan(0.3);
  await page.keyboard.up('KeyW');
});
