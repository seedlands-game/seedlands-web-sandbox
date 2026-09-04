import { expect, test } from '@playwright/test';
import { lockPointer, startHarnessWorld } from '../../../tests/e2e/support/harness';

test('手持工具与真实采集动作同步，松开和减少动态保持信息', async ({ page }) => {
  await startHarnessWorld(page, 'player-action-visual');
  await page.evaluate(async () => {
    const harness = window.__seedlandsHarness!;
    harness.prepareFlatMovement();
    harness.setView(0, -42);
    await harness.executeGameplayCommand({ type: 'give-item', itemId: 'wood-axe', count: 1 });
  });
  const held = page.getByRole('img', { name: '手持 木斧', exact: true });
  await expect(held).toBeVisible();
  await lockPointer(page);
  await page.mouse.down();
  await expect(held).toHaveAttribute('data-action', 'mining');
  await page.mouse.up();
  await expect(held).toHaveAttribute('data-action', 'idle');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.mouse.down();
  await expect(held).toHaveAttribute('data-action', 'mining');
  expect(await page.locator('.held-hand').evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
  await page.mouse.up();
});
