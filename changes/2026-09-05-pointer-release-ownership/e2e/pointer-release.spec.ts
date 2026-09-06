import { expect, test } from '@playwright/test';
import { lockPointer, startHarnessWorld } from '../../../tests/e2e/support/harness';

test('主动释放的迟到事件不抢占背包', async ({ page }) => {
  await startHarnessWorld(page, 'seedlands-overlay-ownership');
  await page.evaluate(() => {
    document.addEventListener('pointerlockchange', () => {
      document.documentElement.dataset.pointerState = document.pointerLockElement ? 'locked' : 'released';
    });
  });
  await lockPointer(page);
  await page.keyboard.press('KeyE');
  await expect(page.getByRole('dialog', { name: '背包与合成' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '背包与合成' })).toBeHidden();
  await expect(page.locator('html')).toHaveAttribute('data-pointer-state', 'released');
  await expect(page.getByRole('heading', { name: '旅途暂歇' })).toBeHidden();
});

test('真实Escape仍暂停', async ({ page }) => {
  await startHarnessWorld(page, 'seedlands-overlay-ownership');
  await lockPointer(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: '旅途暂歇' })).toBeVisible();
});
