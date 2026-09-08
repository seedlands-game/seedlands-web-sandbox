import { expect, test } from '@playwright/test';
const probes = '/changes/2026-09-08-asset-appearance-center/e2e/render-probes.ts';

test('19对象与108资源完整可达、每种模型预览、同页编辑与窄屏', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/asset-workbench.html');
  await expect(page.locator('button.object')).toHaveCount(19);
  const names = await page.locator('button.object strong').allTextContents();
  for (const name of names) {
    await page
      .locator('button.object')
      .filter({ has: page.getByText(name, { exact: true }) })
      .click();
    await expect(page.locator('.viewport')).toHaveAttribute('data-ready', 'true');
    const scene = await page.evaluate(
      async (path) => ((await import(path)) as typeof import('./render-probes')).currentScene(),
      probes,
    );
    expect(scene.meshes).toBeGreaterThan(0);
  }
  await page.getByRole('button', { name: '资源', exact: true }).click();
  let total = 0;
  for (const name of ['模型', '材质', '图像']) {
    await page.locator('.categories').first().getByRole('button', { name, exact: true }).click();
    total += await page.locator('button.resource').count();
  }
  expect(total).toBe(108);
  await page.getByRole('button', { name: '对象', exact: true }).click();
  await page
    .locator('button.object')
    .filter({ has: page.getByText('玩家', { exact: true }) })
    .click();
  await page.getByRole('button', { name: '建立此对象的专用副本', exact: true }).first().click();
  await page
    .getByRole('button', { name: /编辑贴图：.*专用/ })
    .first()
    .click();
  await expect(page.locator('.viewport')).toHaveAttribute('data-type', 'builtin-actor-model');
  const before = await page.evaluate(
    async (path) => ((await import(path)) as typeof import('./render-probes')).cameraPosition(),
    probes,
  );
  await page.getByLabel('编辑颜色 1', { exact: true }).fill('#348bce');
  await expect(page.locator('.viewport')).toHaveAttribute('data-ready', 'true');
  expect(
    await page.evaluate(
      async (path) => ((await import(path)) as typeof import('./render-probes')).cameraPosition(),
      probes,
    ),
  ).toEqual(before);
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText(/草稿已保存到此浏览器/)).toBeVisible();
  await page.screenshot({ path: info.outputPath('actor-private-material.png') });
  await page.setViewportSize({ width: 700, height: 900 });
  await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('appearance-700.png') });
  expect(errors).toEqual([]);
});

test('原生新建、64px源保留、复制与恢复编辑历史', async ({ page }) => {
  await page.goto('/asset-workbench.html');
  await page.getByRole('button', { name: '新建像素源', exact: true }).click();
  await page.getByLabel('新建资产类型').selectOption('texture');
  await page.getByLabel('画布尺寸').selectOption('64');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.locator('.canvas-caption')).toContainText('64 × 64');
  await page.getByLabel('编辑颜色 1', { exact: true }).fill('#6ab883');
  await page.getByLabel('像素画布，方向键移动，空格绘制').press('Space');
  await page.getByRole('button', { name: '复制为独立源', exact: true }).click();
  await expect(page.getByText(/已复制 1 项原生资产/)).toBeVisible();
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText(/草稿已保存到此浏览器/)).toBeVisible();
  const saved = await page.evaluate(
    async (path) => ((await import(path)) as typeof import('./render-probes')).snapshot(),
    probes,
  );
  expect(
    saved.draft.assets.filter((asset) => asset.type === 'pixel-texture').map((asset) => asset.payload.width),
  ).toEqual([64, 64]);
  expect(saved.applied.assets).toEqual([]);
});
