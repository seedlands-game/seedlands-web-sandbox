import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { modelFixture } from './model-fixture';
import { startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';
const entry = '/asset-workbench.html';
const probePath = '/changes/2026-09-08-unified-visual-assets/e2e/browser-probes.ts';

test('完整用途目录、逐类真实预览与窄屏可用', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(entry);
  await expect(page.locator('.viewport')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.asset-row')).toHaveCount(33);
  for (const name of [
    '草方块 方块模型',
    '水 方块模型',
    '灯笼 方块模型',
    '玩家 角色模型',
    '居民 角色模型',
    '食草兽 角色模型',
    '玩家手臂 第一人称手臂',
  ]) {
    await page.getByRole('button', { name: new RegExp(name) }).click();
    await expect(page.locator('.viewport')).toHaveAttribute('data-ready', 'true');
    const state = await page.evaluate(
      async (path) => ((await import(path)) as typeof import('./browser-probes')).sceneState(),
      probePath,
    );
    expect(state.renderCount).toBeGreaterThan(0);
    expect(state.cuff).toBe(false);
  }
  await page.getByRole('button', { name: /玩家 角色模型/ }).click();
  await expect(page.locator('.viewport')).toHaveAttribute('data-ready', 'true');
  await page.screenshot({ path: info.outputPath('player-workbench.png') });
  await page.getByRole('button', { name: '草方块 方块模型', exact: true }).click();
  await expect(page.locator('.viewport')).toHaveAttribute('data-ready', 'true');
  await page.screenshot({ path: info.outputPath('terrain-workbench.png') });
  await page.setViewportSize({ width: 700, height: 850 });
  await page.getByRole('button', { name: '预览', exact: true }).click();
  await expect(page.locator('.preview-pane')).toBeVisible();
  await expect(page.locator('.viewport')).toBeVisible();
  await expect(page.locator('.viewport')).toHaveAttribute('data-ready', 'true');
  await page.screenshot({ path: info.outputPath('workbench-700.png') });
  expect(errors).toEqual([]);
});

test('GLB从文件导入、刷新重载、原样导出及反复切换释放', async ({ page }, info) => {
  await page.goto(entry);
  const original = modelFixture();
  await page
    .getByLabel('导入静态 GLB', { exact: true })
    .setInputFiles({ name: '木箱样例.glb', mimeType: 'model/gltf-binary', buffer: original });
  await expect(page.getByRole('heading', { name: '木箱样例.glb', exact: true })).toBeVisible();
  await expect(page.locator('.viewport')).toHaveAttribute('data-ready', 'true');
  await page.screenshot({ path: info.outputPath('imported-glb.png') });
  await page.reload();
  await page.getByRole('button', { name: /木箱样例.glb/ }).click();
  await expect(page.locator('.viewport')).toHaveAttribute('data-ready', 'true');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出原始 GLB' }).click();
  const file = await download;
  expect(await readFile((await file.path())!)).toEqual(original);
  // Warm the engine's per-application primitive cache before measuring transient imports.
  await page.getByRole('button', { name: /玩家 角色模型/ }).click();
  await expect(page.locator('.viewport')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: /木箱样例.glb/ }).click();
  await expect(page.locator('.viewport')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(
    async (path) => ((await import(path)) as typeof import('./browser-probes')).startResources(),
    probePath,
  );
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: '泥土 方块模型', exact: true }).click();
    await expect(page.locator('.viewport')).toHaveAttribute('data-ready', 'true');
    await page.getByRole('button', { name: /木箱样例.glb/ }).click();
    await expect(page.locator('.viewport')).toHaveAttribute('data-ready', 'true');
  }
  await page.getByRole('button', { name: /玩家 角色模型/ }).click();
  await expect(page.locator('.viewport')).toHaveAttribute('data-ready', 'true');
  const resources = await page.evaluate(
    async (path) => ((await import(path)) as typeof import('./browser-probes')).stopResources(),
    probePath,
  );
  expect(resources?.live).toBe(0);
  expect(resources?.repeated).toBe(0);
  await page.getByRole('button', { name: /木箱样例.glb/ }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '删除模型' }).click();
  await expect(page.getByRole('button', { name: /木箱样例.glb/ })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: /木箱样例.glb/ })).toHaveCount(0);
});

test('贴图编辑生成独立快照，在真实世界应用并恢复默认', async ({ page, context }, info) => {
  await page.goto(entry);
  await page.getByRole('button', { name: '泥土 方块模型', exact: true }).click();
  await page.getByRole('button', { name: '泥土材质 →', exact: true }).click();
  await page.getByRole('button', { name: '泥土贴图 →', exact: true }).click();
  await page.getByRole('button', { name: '复制为草稿', exact: true }).click();
  await page.getByLabel('资产名称', { exact: true }).fill('试用泥土');
  await page.getByLabel('资产名称', { exact: true }).press('Tab');
  await page.getByRole('button', { name: '颜色 1', exact: true }).click();
  await page.getByLabel('编辑颜色', { exact: true }).fill('#ef4466');
  const canvas = page.getByLabel('像素画布，方向键移动，空格绘制');
  await canvas.focus();
  await canvas.press('Space');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await page.getByRole('button', { name: '应用贴图到游戏', exact: true }).click();
  await expect(page.getByText('泥土 ← 试用泥土', { exact: true })).toBeVisible();
  const expected = await page.evaluate(async () => {
    const path = '/src/client/persistence/terrain-pack-store.ts';
    const pack = await (
      (await import(path)) as typeof import('../../../src/client/persistence/terrain-pack-store')
    ).loadTerrainPack();
    const texture = pack.overrides[0].texture;
    return texture.payload.pixels.flatMap((i) => (i === 0 ? [0, 0, 0, 0] : [...texture.payload.palette[i], 255]));
  });
  await page.getByLabel('编辑颜色', { exact: true }).fill('#4488ef');
  const game = await context.newPage();
  await startHarnessWorld(game, 'mosslight-68');
  await waitForSnapshot(game, (s) => s.renderedChunks > 0 && s.onGround);
  const actual = await game.evaluate(
    async (path) => ((await import(path)) as typeof import('./browser-probes')).gameDirtPixels(),
    probePath,
  );
  expect(actual?.width).toBe(16);
  expect(actual?.pixels).toEqual(expected);
  await game.evaluate(async () => {
    const h = window.__seedlandsHarness!;
    await h.setWorldTime(10);
    h.setTimePaused(true);
  });
  await waitForSnapshot(
    game,
    (s) => s.generationQueue === 0 && s.meshingQueue === 0 && s.performance.uploadQueueDepth === 0,
  );
  await game.keyboard.press('F3');
  await game.screenshot({ path: info.outputPath('game-texture-and-arm.png') });
  await page.getByRole('button', { name: '恢复此材质默认', exact: true }).click();
  await expect(page.getByText('当前 0 项覆盖。', { exact: false })).toBeVisible();
  await game.close();
  const restored = await context.newPage();
  await startHarnessWorld(restored, 'mosslight-68');
  await waitForSnapshot(restored, (s) => s.generationQueue === 0 && s.meshingQueue === 0 && s.renderedChunks > 0);
  const restoredPixels = await restored.evaluate(
    async (path) => ((await import(path)) as typeof import('./browser-probes')).gameDirtPixels(),
    probePath,
  );
  expect(restoredPixels?.pixels).not.toEqual(expected);
  await restored.keyboard.press('F3');
  await restored.screenshot({ path: info.outputPath('game-default-restored.png') });
  await restored.close();
  const storage = await page.evaluate(
    async (path) => ((await import(path)) as typeof import('./browser-probes')).packStorageCases(),
    probePath,
  );
  expect(storage).toEqual({ success: 1, rejected: true, unchanged: true });
});

test('图集导出包含稳定索引与独立源，非法GLB不写入库', async ({ page }, info) => {
  await page.goto(entry);
  await page.getByRole('button', { name: '泥土 方块模型', exact: true }).click();
  await expect(page.getByRole('button', { name: '导出图集与索引', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '导出图集与索引', exact: true }).click();
  await expect(page.getByAltText('编译后的纹理图集')).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('link', { name: '下载索引与源数据' }).click();
  const file = await downloaded;
  const manifest = JSON.parse(await readFile((await file.path())!, 'utf8')) as {
    format: string;
    atlas: { entries: { id: string }[]; padding: number };
    sources: { id: string }[];
  };
  expect(manifest.format).toBe('seedlands-texture-atlas');
  expect(manifest.atlas.padding).toBe(1);
  expect(manifest.atlas.entries.map((e) => e.id)).toEqual(manifest.sources.map((s) => s.id));
  expect(manifest.sources.length).toBeGreaterThan(30);
  await page.screenshot({ path: info.outputPath('compiled-atlas.png') });
  await page
    .getByLabel('导入静态 GLB', { exact: true })
    .setInputFiles({ name: 'invalid.glb', mimeType: 'model/gltf-binary', buffer: Buffer.alloc(12) });
  await expect(page.locator('.model-import .error')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /invalid.glb/ })).toHaveCount(0);
});
