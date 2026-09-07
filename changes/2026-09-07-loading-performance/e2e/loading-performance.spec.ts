import { expect, test } from '@playwright/test';

test('HTML 骨架在运行时之前可交互但禁止进入，并提供 SEO/GEO', async ({ page }) => {
  await page.route(
    '**/src/app/main.ts*',
    async (route) => new Promise((resolve) => setTimeout(() => resolve(route.continue()), 2_000)),
  );
  await page.goto('/');
  await expect(page.locator('[data-ui-fallback]')).toBeVisible();
  await page.locator('#seed').fill('early-input');
  await expect(page.locator('#seed')).toHaveValue('early-input');
  await expect(page.locator('#enter')).toBeDisabled();
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /体素|世界/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /seedlands/);
  await expect(page.locator('script[type="application/ld+json"]')).toContainText('VideoGame');
});

test('无需点击即请求异步运行时和世界纹理，ready 后允许进入', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/');
  await expect(page.locator('#enter')).toBeEnabled({ timeout: 15_000 });
  expect(requests.some((url) => /bootstrap|app-runtime/.test(url))).toBe(true);
  expect(requests.some((url) => url.includes('voxel-atlas.webp'))).toBe(true);
});

test('世界初始化期间显示专用 loading 菜单', async ({ page }) => {
  await page.goto('/?harness=1');
  await expect(page.locator('#enter')).toBeEnabled({ timeout: 15_000 });
  await page.locator('#seed').fill('loading-evidence');
  await page.locator('#enter').click();
  const loading = page.locator('[data-world-loading]');
  await expect(loading).toBeVisible();
  await expect(loading).toContainText(/区块|地形|世界|光照|生灵/);
  await page.screenshot({ path: 'changes/2026-09-07-loading-performance/evidence/world-loading.png' });
  await expect(page.locator('#hud')).toBeVisible({ timeout: 30_000 });
});
