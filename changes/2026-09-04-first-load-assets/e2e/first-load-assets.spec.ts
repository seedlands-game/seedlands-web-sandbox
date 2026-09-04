import { expect, test } from '@playwright/test';

test('首屏延迟加载游戏运行时并在点击后正常进入世界', async ({ page }) => {
  const scripts = new Set<string>();
  page.on('response', (response) => {
    const pathname = new URL(response.url()).pathname;
    if (pathname.endsWith('.js')) scripts.add(pathname);
  });

  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Seedlands' })).toBeVisible();
  expect([...scripts].some((path) => path.includes('playcanvas'))).toBe(false);

  await page.getByLabel('世界 Seed').fill('first-load-assets');
  await page.getByRole('button', { name: '进入世界' }).click();
  await expect(page.locator('#hud')).toBeVisible();
  expect([...scripts].some((path) => path.includes('playcanvas'))).toBe(true);
});
