import { expect, test } from '@playwright/test';

test('HTML 骨架在运行时之前可交互但禁止进入，并提供 SEO/GEO', async ({ page }) => {
  let releaseBootstrap!: () => void;
  const bootstrapGate = new Promise<void>((resolve) => {
    releaseBootstrap = resolve;
  });
  await page.route('**/src/app/bootstrap.ts*', async (route) => {
    await bootstrapGate;
    await route.continue();
  });
  await page.goto('/');
  await expect(page.locator('[data-ui-prerendered="svelte5"]')).toBeVisible();
  await page.locator('#seed').fill('early-input');
  await page.locator('#quality').selectOption('high');
  await expect(page.locator('#seed')).toHaveValue('early-input');
  await expect(page.locator('#enter')).toBeDisabled();
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /体素|世界/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /seedlands/);
  expect(await page.locator('script[type="application/ld+json"]').textContent()).toContain('VideoGame');
  releaseBootstrap();
  await expect(page.locator('[data-ui-runtime="svelte5"]')).toBeVisible();
  await expect(page.getByRole('textbox', { name: '世界 Seed' })).toHaveValue('early-input');
  await expect(page.getByRole('combobox', { name: '视觉质量' })).toHaveValue('high');
});

test('无需点击即请求异步运行时和世界纹理，ready 后允许进入', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  let releaseAtlas!: () => void;
  const atlasGate = new Promise<void>((resolve) => {
    releaseAtlas = resolve;
  });
  await page.route('**/assets/voxel-atlas.webp', async (route) => {
    await atlasGate;
    await route.continue();
  });
  await page.goto('/');
  await expect(page.locator('#enter')).toBeDisabled();
  expect(requests.some((url) => /bootstrap|app-runtime/.test(url))).toBe(true);
  expect(requests.some((url) => url.includes('voxel-atlas.webp'))).toBe(true);
  releaseAtlas();
  await expect(page.getByRole('button', { name: '进入世界', exact: true })).toBeEnabled({ timeout: 15_000 });
});

test('资源预取失败时保留可读的重试入口', async ({ page }) => {
  await page.route('**/assets/voxel-atlas.webp', (route) =>
    route.fulfill({ status: 503, contentType: 'text/plain', body: 'unavailable' }),
  );
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText(/资源加载失败/);
  await expect(page.getByRole('button', { name: '重新加载游戏资源' })).toBeEnabled();
});

test('世界初始化期间显示专用 loading 菜单', async ({ page }) => {
  await page.goto('/?harness=1');
  const enter = page.getByRole('button', { name: '进入世界', exact: true });
  await expect(enter).toBeEnabled({ timeout: 15_000 });
  await page.getByRole('textbox', { name: '世界 Seed' }).fill('loading-evidence');
  await enter.click();
  const continueDespiteWarning = page.getByRole('button', { name: '仍然进入' });
  if (await continueDespiteWarning.isVisible()) await continueDespiteWarning.click();
  const loading = page.locator('[data-world-loading]');
  await expect(loading).toBeVisible();
  await expect(loading).toContainText(/区块|地形|世界|光照|生灵/);
  await page.screenshot({ path: 'changes/2026-09-07-loading-performance/evidence/world-loading.png' });
  await expect(page.locator('#hud')).toBeVisible({ timeout: 30_000 });
  const loadedChunks = await page.evaluate(() => {
    const harness = (
      window as Window & {
        __seedlandsHarness?: { snapshot: () => { loadedChunks: number; renderedChunks: number } };
      }
    ).__seedlandsHarness;
    return harness?.snapshot() ?? { loadedChunks: -1, renderedChunks: -1 };
  });
  expect(loadedChunks.loadedChunks).toBeGreaterThan(0);
  expect(loadedChunks.renderedChunks).toBeGreaterThan(0);
});
