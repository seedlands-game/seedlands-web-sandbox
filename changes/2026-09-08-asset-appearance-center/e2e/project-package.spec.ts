import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const probes = '/changes/2026-09-08-asset-appearance-center/e2e/project-probes.ts';
test('Blender GLB重导入与完整项目空库恢复、失败原子性', async ({ page, browser }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/asset-workbench.html');
  const original = await readFile('public/assets/samples/brass-trail-lantern.glb');
  await page
    .getByLabel('导入静态 GLB', { exact: true })
    .setInputFiles({ name: '体素灯笼.glb', mimeType: 'model/gltf-binary', buffer: original });
  await expect(page.getByRole('heading', { name: '体素灯笼.glb', exact: true }).first()).toBeVisible();
  await expect(page.locator('.viewport')).toHaveAttribute('data-ready', 'true');
  const [before] = await page.evaluate(
    async (path) => ((await import(path)) as typeof import('./project-probes')).listGlbModels(),
    probes,
  );
  await page
    .getByLabel('重导入静态 GLB', { exact: true })
    .setInputFiles({ name: '体素灯笼-v2.glb', mimeType: 'model/gltf-binary', buffer: original });
  await expect(page.getByText(/重导入.*成功|已重导入/)).toBeVisible();
  const [after] = await page.evaluate(
    async (path) => ((await import(path)) as typeof import('./project-probes')).listGlbModels(),
    probes,
  );
  expect(after.id).toBe(before.id);
  expect(after.revision).toBe(before.revision + 1);
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出完整项目', exact: true }).click();
  const file = await downloaded;
  const packageBytes = await readFile((await file.path())!);
  const fresh = await browser.newContext();
  const restored = await fresh.newPage();
  restored.on('pageerror', (error) => errors.push(error.message));
  await restored.goto(new URL('/asset-workbench.html', page.url()).href);
  await restored
    .getByLabel('导入完整项目', { exact: true })
    .setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: packageBytes });
  await expect(restored.getByText(/完整项目包已导入为草稿/)).toBeVisible();
  const [restoredModel] = await restored.evaluate(
    async (path) => ((await import(path)) as typeof import('./project-probes')).listGlbModels(),
    probes,
  );
  expect(restoredModel).toEqual(after);
  const bytes = await restored.evaluate(
    async ({ path, id }) => ((await import(path)) as typeof import('./project-probes')).modelBytes(id),
    { path: probes, id: after.id },
  );
  expect(Buffer.from(bytes)).toEqual(original);
  await restored.locator('button.object').filter({ hasText: '体素灯笼-v2.glb' }).click();
  await expect(restored.locator('.viewport')).toHaveAttribute('data-ready', 'true');
  await restored.locator('.viewport').scrollIntoViewIfNeeded();
  await restored.screenshot({ path: info.outputPath('blender-lantern-project-restored.png') });
  expect(
    await restored.evaluate(
      async (path) => ((await import(path)) as typeof import('./project-probes')).atomicStorageCases(),
      probes,
    ),
  ).toEqual({ successfulWrites: 1, rejected: true, unchanged: true });
  const conflict = await restored.evaluate(
    async (path) => ((await import(path)) as typeof import('./project-probes')).glbSaveConflict(),
    probes,
  );
  expect(conflict.rejected).toBe(true);
  expect(conflict.revision).toBe(conflict.expectedRevision);
  await fresh.close();
  expect(errors).toEqual([]);
});
