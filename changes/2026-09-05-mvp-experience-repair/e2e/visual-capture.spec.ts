import { expect, test } from '@playwright/test';

test('保存原型比对的实际林间游戏、目标与菜单画面', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/?harness=1');
  await expect(page.getByRole('button', { name: '进入世界', exact: true })).toBeEnabled();
  await page.screenshot({ path: 'changes/2026-09-05-mvp-experience-repair/evidence/menu-1920.png' });
  await page.getByLabel('世界 Seed', { exact: true }).fill('mosslight-68');
  await page.getByRole('button', { name: '进入世界', exact: true }).click();
  await expect(page.locator('#hud')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__seedlandsHarness?.snapshot().renderedChunks ?? 0))
    .toBeGreaterThan(10);
  await page.evaluate(async () => {
    const h = window.__seedlandsHarness!;
    h.setTimePaused(true);
    h.setWorldTime(10);
    await h.executeGameplayCommand({ type: 'give-item', itemId: 'wood-axe', count: 1 });
    await h.executeGameplayCommand({ type: 'give-item', itemId: 'wood-block', count: 12 });
    await h.executeGameplayCommand({ type: 'give-item', itemId: 'stone-pickaxe', count: 1 });
    h.setSpectatorPosition(25, 29, -18);
    h.setView(-35, -23);
  });
  await page.keyboard.press('F3');
  await expect(page.locator('#debug')).toBeHidden();
  await page.locator('#game').click();
  await expect.poll(() => page.evaluate(() => window.__seedlandsHarness!.snapshot().generationQueue)).toBe(0);
  await page.screenshot({ path: 'changes/2026-09-05-mvp-experience-repair/evidence/world-1920.png' });
  await page.screenshot({ path: 'changes/2026-09-05-mvp-experience-repair/evidence/world-wood-axe-1920.png' });
  await page.keyboard.press('Digit3');
  await expect(page.locator('#player-action')).toHaveAttribute('aria-label', '手持 石镐');
  await page.screenshot({ path: 'changes/2026-09-05-mvp-experience-repair/evidence/world-stone-pickaxe-1920.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '暂停游戏', exact: true })).toBeVisible();
  await page.screenshot({ path: 'changes/2026-09-05-mvp-experience-repair/evidence/pause-1920.png' });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '设置', exact: true })).toBeVisible();
  await page.screenshot({ path: 'changes/2026-09-05-mvp-experience-repair/evidence/settings-1920.png' });
});
