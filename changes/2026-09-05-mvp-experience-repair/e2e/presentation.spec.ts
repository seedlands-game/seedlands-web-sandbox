import { expect, test } from '@playwright/test';
import { startHarnessWorld } from '../../../tests/e2e/support/harness';

const viewports = [
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1272x868', width: 1272, height: 868 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '700x720', width: 700, height: 720 },
];

for (const viewport of viewports) {
  test(`生存HUD在${viewport.name}保持紧凑、可操作且不相交`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await startHarnessWorld(page, `presentation-${viewport.name}`);
    await page.keyboard.press('F3');
    await page.screenshot({
      path: `changes/2026-09-05-mvp-experience-repair/evidence/presentation-${viewport.name}.png`,
    });

    const deck = page.locator('#survival-deck');
    const vitals = deck.locator('#survival-vitals');
    const hotbar = deck.locator('#hotbar');
    await expect(deck).toBeVisible();
    await expect(vitals).toBeVisible();
    await expect(hotbar).toBeVisible();
    await expect(hotbar.locator('li')).toHaveCount(8);
    await expect(vitals.getByRole('meter')).toHaveCount(2);

    const geometry = await page.evaluate(() => {
      const rect = (selector: string) => {
        const node = document.querySelector(selector);
        if (!node) throw new Error(`Missing ${selector}`);
        const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
        return { left, right, top, bottom, width, height };
      };
      return { deck: rect('#survival-deck'), vitals: rect('#survival-vitals'), hotbar: rect('#hotbar') };
    });
    expect(geometry.deck.width).toBeLessThanOrEqual(viewport.width);
    expect(geometry.vitals.bottom).toBeLessThanOrEqual(geometry.hotbar.top + 1);
    expect(geometry.vitals.left).toBeGreaterThanOrEqual(0);
    expect(geometry.hotbar.right).toBeLessThanOrEqual(viewport.width);

    await expect(page.locator('.gloved-hand')).toHaveCount(0);
    await expect(page.locator('#presented-entity-semantics [role="img"]')).toHaveCount(0);
    await page
      .locator('#game')
      .screenshot({ path: `changes/2026-09-05-mvp-experience-repair/evidence/canvas-${viewport.name}.png` });
  });
}

test('实体标签只在F3调试模式出现，暂停菜单保留统一纹章', async ({ page }) => {
  await startHarnessWorld(page, 'presentation-debug');
  await page.evaluate(() =>
    window.__seedlandsHarness!.executeGameplayCommand({ type: 'spawn-creature', position: [1, 58, 0] }),
  );
  await page.keyboard.press('F3');
  await expect(page.locator('#presented-entity-semantics [role="img"]')).toHaveCount(0);
  await page.keyboard.press('F3');
  await expect(page.locator('#presented-entity-semantics [role="img"]')).not.toHaveCount(0);
  await page.getByRole('button', { name: '暂停游戏', exact: true }).click();
  await expect(page.locator('.shell-dialog[data-kind="pause"] .menu-crest')).toBeVisible();
  await page.screenshot({ path: 'changes/2026-09-05-mvp-experience-repair/evidence/presentation-pause.png' });
});
