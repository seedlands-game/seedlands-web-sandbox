import { expect, test, type Page } from '@playwright/test';
import { lockPointer, startHarnessWorld } from '../../../tests/e2e/support/harness';

async function command(page: Page, value: string) {
  await page.keyboard.press('F4');
  const dialog = page.getByRole('dialog', { name: '服务端调试命令' });
  await dialog.getByRole('textbox', { name: '命令', exact: true }).fill(value);
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('status')).toContainText('成功');
  await page.keyboard.press('Escape');
}
async function sounds(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __seedlandsAudio: { snapshot: () => { recentSounds: Array<{ key: string; sequence: number }> } };
        }
      ).__seedlandsAudio.snapshot().recentSounds,
  );
}

test('背包移动、指定格食用、满饥饿拒绝、右键食用与保存继续', async ({ page }) => {
  await startHarnessWorld(page, 'survival-presentation-inventory');
  await command(page, '/give berry 70');
  await page.evaluate(() => window.__seedlandsHarness!.advanceGameplay(1200));
  await page.keyboard.press('KeyE');
  const inventory = page.getByRole('dialog', { name: '背包与合成' });
  const slot = (index: number) => inventory.locator(`[data-slot="${index}"]`);
  await slot(1).click();
  await expect(inventory.getByRole('status', { name: '背包操作提示' })).toContainText('已选');
  await slot(9).click();
  await expect(slot(1)).toHaveAttribute('data-item', 'empty');
  await expect(slot(9)).toHaveAccessibleName('浆果 6');
  await slot(9).click();
  await inventory.getByRole('button', { name: '食用浆果', exact: true }).click();
  await expect(slot(9)).toHaveAccessibleName('浆果 5');
  await expect(slot(0)).toHaveAccessibleName('浆果 64');
  await expect.poll(async () => (await sounds(page)).some((sound) => sound.key === 'eat')).toBe(true);
  await inventory.getByRole('button', { name: '食用浆果', exact: true }).click();
  await expect(slot(9)).toHaveAccessibleName('浆果 4');
  await inventory.getByRole('button', { name: '食用浆果', exact: true }).click();
  await expect(slot(9)).toHaveAccessibleName('浆果 3');
  const before = (await sounds(page)).at(-1)?.sequence ?? 0;
  await inventory.getByRole('button', { name: '食用浆果', exact: true }).click();
  await expect(page.getByRole('status', { name: '交互反馈' })).toContainText('不饿');
  await expect(slot(9)).toHaveAccessibleName('浆果 3');
  expect((await sounds(page)).filter((sound) => sound.sequence > before && sound.key === 'eat')).toEqual([]);
  await inventory.getByRole('button', { name: '关闭背包' }).click();
  await page.evaluate(() => window.__seedlandsHarness!.advanceGameplay(120));
  await lockPointer(page);
  await page.mouse.click(640, 360, { button: 'right' });
  await page.keyboard.press('KeyE');
  await expect(slot(0)).toHaveAccessibleName('浆果 63');
  await inventory.getByRole('button', { name: '关闭背包' }).click();
  await page.getByRole('button', { name: '暂停游戏', exact: true }).click();
  await page.getByRole('button', { name: '保存并返回主菜单' }).click();
  await page.getByRole('button', { name: '继续世界', exact: true }).click();
  await expect(page.locator('#start-card')).toBeHidden();
  await page.keyboard.press('KeyE');
  await expect(slot(0)).toHaveAccessibleName('浆果 63');
  await expect(slot(9)).toHaveAccessibleName('浆果 3');
});

test('暂停入口紧凑、背包在桌面和窄屏居中且不溢出', async ({ page }) => {
  await startHarnessWorld(page, 'survival-layout');
  const pause = await page.getByRole('button', { name: '暂停游戏', exact: true }).boundingBox();
  expect(pause!.width).toBeLessThanOrEqual(180);
  for (const width of [1280, 700]) {
    await page.setViewportSize({ width, height: 720 });
    await page.keyboard.press('KeyE');
    const panel = await page.locator('.inventory-dialog').boundingBox();
    expect(panel!.x).toBeGreaterThanOrEqual(0);
    expect(panel!.x + panel!.width).toBeLessThanOrEqual(width);
    expect(Math.abs(panel!.x + panel!.width / 2 - width / 2)).toBeLessThan(2);
    expect(panel!.height).toBeLessThanOrEqual(704);
    await page.getByRole('button', { name: '关闭背包' }).click();
  }
});
