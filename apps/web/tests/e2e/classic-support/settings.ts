import { expect, type Page } from '@playwright/test';

export function requireHeadlessClassic(headless: boolean, launchOptions: Readonly<{ headless?: boolean }>): void {
  if (!headless || launchOptions.headless === false)
    throw new Error(
      'Classic acceptance requires bundled Chromium in headless mode; native browser windows are forbidden.',
    );
}

export async function configureClassicSettings(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.locator('#mouse-sensitivity').fill('0.25');
  await expect(page.locator('#mouse-sensitivity')).toHaveValue('0.25');
  await page.locator('#mouse-sensitivity').fill('0.13');
  await page.locator('#settings-difficulty').selectOption('hard');
  await expect(page.locator('#settings-difficulty')).toHaveValue('hard');
  await page.locator('#settings-difficulty').selectOption('normal');
  await expect(page.locator('#settings-difficulty')).toHaveValue('normal');
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '继续游戏', exact: true }).click();
}

export async function deleteClassicWorld(page: Page, seed: string, generatorVersion: number): Promise<void> {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '保存并返回主菜单', exact: true }).click();
  const remove = page.getByRole('button', { name: `删除世界 ${seed} v${generatorVersion}`, exact: true });
  await expect(remove).toBeVisible();
  await remove.click();
  await expect(remove).toHaveCount(0);
}
