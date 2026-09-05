import { expect, test } from '@playwright/test';
import { startHarnessWorld } from '../../../tests/e2e/support/harness';

test('冻结昼夜不冻结输入，背包快捷键可以再次关闭界面', async ({ page }) => {
  await startHarnessWorld(page, 'input-gates');
  await page.evaluate(() => window.__seedlandsHarness!.setTimePaused(true));
  await page.keyboard.press('F3');
  await expect(page.locator('#debug')).toBeHidden();
  await page.keyboard.press('KeyE');
  await expect(page.locator('#inventory-crafting')).toBeVisible();
  await page.keyboard.press('KeyE');
  await expect(page.locator('#inventory-crafting')).toBeHidden();
});
