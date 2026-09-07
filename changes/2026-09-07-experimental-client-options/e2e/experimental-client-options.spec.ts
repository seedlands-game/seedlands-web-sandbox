import { expect, test } from '@playwright/test';
import { EXPERIMENT_STORAGE_KEY } from '../../../src/client/experimental-client-options';
import { snapshot, startHarnessWorld } from '../../../tests/e2e/support/harness';

test('实验设置开关在桌面与窄屏保持紧凑同行', async ({ page }) => {
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('./?harness=1', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '设置' }).click();
    const group = page.getByLabel('实验性性能');
    await expect(group).toBeVisible();
    await expect(group.locator('.experimental-toggle')).toHaveCount(2);
    for (const id of ['settings-wasm', 'settings-simd']) {
      const input = page.locator(`#${id}`);
      const row = group.locator(`label[for="${id}"]`);
      const [inputBox, rowBox] = await Promise.all([input.boundingBox(), row.boundingBox()]);
      expect(inputBox, `${id} checkbox box`).not.toBeNull();
      expect(rowBox, `${id} row box`).not.toBeNull();
      expect(inputBox!.width).toBeLessThanOrEqual(24);
      expect(inputBox!.height).toBeLessThanOrEqual(24);
      expect(rowBox!.height).toBeLessThanOrEqual(72);
      expect(Math.abs(inputBox!.y + inputBox!.height / 2 - (rowBox!.y + rowBox!.height / 2))).toBeLessThanOrEqual(2);
    }
    const sizing = await group.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(sizing.scrollWidth).toBe(sizing.clientWidth);
    await page.screenshot({
      path: `changes/2026-09-07-experimental-client-options/evidence/experimental-settings-${viewport.width}.png`,
    });
  }
});

test('设置修改持久化且只有刷新后应用', async ({ page }) => {
  await page.goto('./?harness=1', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '设置' }).click();
  await page.locator('#settings-wasm').uncheck();
  await expect(page.getByText('需要先启用 Rust WebAssembly')).toBeVisible();
  await expect(page.locator('#settings-simd')).toBeDisabled();
  await expect(page.getByText('配置已保存，刷新页面后生效。')).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), EXPERIMENT_STORAGE_KEY)).toContain('"wasm":false');
  await page.getByRole('button', { name: '返回' }).click();
  await page.locator('#seed').fill('settings-refresh-contract');
  await page.getByRole('button', { name: '进入世界' }).click();
  const warning = page.getByRole('button', { name: '仍然进入' });
  if (await warning.isVisible()) await warning.click();
  await page.locator('#start-card').waitFor({ state: 'hidden' });
  await page.locator('#debug').waitFor({ state: 'visible' });
  const beforeRefresh = await snapshot(page);
  expect(beforeRefresh?.experiments.requested.wasm).toBe(true);

  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#seed').fill('settings-refresh-contract-2');
  await page.getByRole('button', { name: '进入世界' }).click();
  if (await warning.isVisible()) await warning.click();
  await page.locator('#start-card').waitFor({ state: 'hidden' });
  const afterRefresh = await snapshot(page);
  expect(afterRefresh?.experiments.requested.wasm).toBe(false);
  expect(afterRefresh?.experiments.workers.filter(({ lane }) => lane === 'general')).toEqual([
    expect.objectContaining({ status: 'off', effectiveArtifact: 'off' }),
  ]);
});

test('URL 与显式初始化可定向选择 scalar Wasm', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { __SEEDLANDS_INITIAL_OPTIONS__: { experiments: { renderer: 'webgl2' } } });
  });
  await startHarnessWorld(page, 'scalar-wasm-url', '&wasm=w04,w06&simd=off');
  const current = await snapshot(page);
  expect(current?.experiments.requested).toEqual({ renderer: 'webgl2', wasm: true, simd: false });
  expect(current?.experiments.kernels).toEqual(['w04', 'w06']);
  expect(current?.experiments.workers.filter(({ lane }) => lane === 'general')).toEqual([
    expect.objectContaining({ status: 'matched', requestedArtifact: 'scalar', effectiveArtifact: 'scalar' }),
  ]);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), EXPERIMENT_STORAGE_KEY)).toEqual(
    {
      renderer: 'webgl2',
      wasm: true,
      simd: false,
    },
  );
});

test('WebGPU 请求必须读回真实后端或结构化 WebGL2 fallback', async ({ page }) => {
  await startHarnessWorld(page, 'webgpu-readback', '&renderer=webgpu&wasm=off');
  const current = await snapshot(page);
  expect(current?.experiments.renderer?.requestedRenderer).toBe('webgpu');
  expect(['webgpu', 'webgl2']).toContain(current?.experiments.renderer?.effectiveRenderer);
  expect(current?.experiments.renderer?.rendererStatus).toBe(
    current?.experiments.renderer?.effectiveRenderer === 'webgpu' ? 'matched' : 'fallback',
  );
});

test('Worker 不支持时禁止进入；低核心数时确认后才进入', async ({ browser }) => {
  const unsupportedContext = await browser.newContext();
  await unsupportedContext.addInitScript(() => Object.defineProperty(window, 'Worker', { value: undefined }));
  const unsupported = await unsupportedContext.newPage();
  await unsupported.goto('./', { waitUntil: 'networkidle' });
  await expect(unsupported.getByRole('button', { name: '进入世界' })).toBeDisabled();
  await expect(unsupported.getByRole('alert')).toContainText('Web Worker');
  await unsupportedContext.close();

  const lowCoreContext = await browser.newContext();
  await lowCoreContext.addInitScript(() => Object.defineProperty(navigator, 'hardwareConcurrency', { value: 2 }));
  const lowCore = await lowCoreContext.newPage();
  await lowCore.goto('./?harness=1', { waitUntil: 'networkidle' });
  await lowCore.locator('#seed').fill('low-core-warning');
  await lowCore.getByRole('button', { name: '进入世界' }).click();
  await expect(lowCore.getByRole('dialog', { name: '性能提示' })).toContainText('2 个核心');
  await lowCore.getByRole('button', { name: '仍然进入' }).click();
  await lowCore.locator('#start-card').waitFor({ state: 'hidden' });
  await lowCoreContext.close();
});
