import { expect, test } from '@playwright/test';
const path = '/changes/2026-09-07-asset-workbench/e2e/probes.ts';

test('真实 IndexedDB 并发拒绝覆盖，写入失败保留原库', async ({ page }) => {
  await page.goto('asset-workbench.html');
  await expect(page.getByRole('status', { name: '保存状态' })).toContainText('已就绪');
  const result = await page.evaluate(
    async (path) => ((await import(path)) as typeof import('./probes')).storageCases(),
    path,
  );
  expect(result).toEqual({ fulfilled: 1, rejected: 1, failed: true, unchanged: true, revision: 1 });
});

test('50 次真实编辑与切换释放 GPU 资源，不积累旧草稿网格', async ({ page }, testInfo) => {
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto('asset-workbench.html');
  await expect(page.locator('.viewport')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: '复制为草稿', exact: true }).click();
  const result = await page.evaluate(async (path) => {
    const module = (await import(path)) as typeof import('./probes');
    const finish = module.resourceProbe();
    let result: ReturnType<typeof finish>;
    try {
      for (let i = 0; i < 50; i++) {
        const input = document.querySelector<HTMLInputElement>('[aria-label="模型厚度"]')!;
        input.value = String((i % 8) + 1);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
    } finally {
      result = finish();
    }
    return result;
  }, path);
  expect(result.generated).toBeGreaterThanOrEqual(49);
  expect(result.live).toBeLessThanOrEqual(1);
  expect(result.repeated).toBe(0);
  await testInfo.attach('gpu-lifecycle', { body: JSON.stringify(result), contentType: 'application/json' });
  await page.getByLabel('预览模式').selectOption('held');
  await expect(page.locator('.viewport')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: '连续采集', exact: true }).click();
  await page.waitForTimeout(100);
  const pose = () =>
    page.evaluate(async (path) => ((await import(path)) as typeof import('./probes')).heldPose(), path);
  await expect.poll(async () => (await pose()).some((v) => Math.abs(v) > 1)).toBe(true);
  await page.getByRole('button', { name: '停止收手', exact: true }).click();
  await expect.poll(async () => (await pose()).every((v) => Math.abs(v) < 0.01)).toBe(true);
  const closed = await page.evaluate(async (path) => {
    const probe = (await import(path)) as typeof import('./probes');
    const finish = probe.resourceProbe();
    const input = document.querySelector<HTMLInputElement>('[aria-label="模型厚度"]')!;
    input.value = '4';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    return finish();
  }, path);
  expect(closed.live).toBe(0);
  expect(closed.generated).toBeGreaterThan(0);
  expect(closed.repeated).toBe(0);
  expect(closed.texturesDestroyed).toBeGreaterThan(0);
  await testInfo.attach('gpu-page-exit', { body: JSON.stringify(closed), contentType: 'application/json' });
});

test('新建、删除引用保护、非法导入、保存失败和窄屏控件可达', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto('asset-workbench.html');
  await expect(page.getByRole('status', { name: '保存状态' })).toContainText('已就绪');
  await page.getByRole('button', { name: '＋ 新建资产', exact: true }).click();
  await page.getByLabel('画布尺寸').selectOption('32');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByLabel('资产名称')).toHaveValue('新物品模型');
  await page.getByRole('button', { name: '新像素贴图 草稿 · 像素贴图', exact: true }).click();
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await expect(page.getByRole('status', { name: '保存状态' })).toContainText('仍被引用');
  await page.locator('input[type=file]').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"schemaVersion":99,"assets":[]}'),
  });
  await expect(page.getByRole('status', { name: '保存状态' })).toContainText('导入失败');
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
  });
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.getByRole('status', { name: '保存状态' })).toContainText('保存失败');
  await expect(page.getByLabel('资产名称')).toHaveValue('新像素贴图');
  await expect(page.getByRole('button', { name: '导出全部草稿', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 700, height: 900 });
  await page.getByRole('button', { name: '资产库', exact: true }).click();
  await expect(page.getByLabel('搜索资产')).toBeVisible();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  const canvas = page.getByLabel('像素画布，方向键移动，空格绘制');
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  await expect(page.getByText('坐标 1, 0', { exact: true })).toBeVisible();
});

test('WebGL2 不可用时保留目录与 2D 编辑，不能显示预览成功', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, contextId: string, ...args: unknown[]) {
      if (contextId === 'webgl2') return null;
      return Reflect.apply(original, this, [contextId, ...args]);
    } as typeof original;
  });
  await page.goto('asset-workbench.html');
  await expect(page.getByRole('alert')).toContainText('3D 不可用');
  await expect(page.locator('.viewport')).toHaveAttribute('data-ready', 'false');
  await page.getByRole('button', { name: '复制为草稿', exact: true }).click();
  await expect(page.getByLabel('像素画布，方向键移动，空格绘制')).toBeVisible();
  await page.getByLabel('资产名称').fill('无GPU草稿');
  await page.getByLabel('资产名称').press('Tab');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.getByRole('status', { name: '保存状态' })).toContainText('已保存');
});

test('晚到的图片预览不能覆盖新选中的模型', async ({ page }) => {
  await page.goto('asset-workbench.html');
  await expect(page.locator('.viewport')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: '灯笼 内置程序化模型', exact: true }).click();
  await page.evaluate(async (path) => ((await import(path)) as typeof import('./probes')).delayImageDecode(), path);
  await page.getByRole('button', { name: '图标 / 贴图', exact: true }).click();
  await expect(page.locator('.viewport')).toHaveAttribute('data-ready', 'false');
  await page.getByRole('button', { name: '石镐 像素挤出模型', exact: true }).click();
  await expect(page.locator('.viewport')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(async (path) => ((await import(path)) as typeof import('./probes')).resumeImageDecode(), path);
  expect(
    await page.evaluate(
      async (path) => ((await import(path)) as typeof import('./probes')).currentPreviewNodes(),
      path,
    ),
  ).toEqual({ pixel: true, plane: false });
});
