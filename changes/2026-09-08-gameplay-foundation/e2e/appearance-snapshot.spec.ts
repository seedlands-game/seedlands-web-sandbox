import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('恢复上一版后工坊重载模型集合与片段，并可继续保存导出', async ({ page }) => {
  await page.goto('asset-workbench.html');
  await expect(page.locator('.viewport')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(async () => {
    const base = new URL('.', location.href);
    const store = (await import(
      new URL('src/client/persistence/appearance-project-store.ts', base).href
    )) as typeof import('../../../apps/web/src/client/persistence/appearance-project-store');
    const { createEmptyAppearanceProject } = (await import(
      new URL('src/client/presentation/appearance-project.ts', base).href
    )) as typeof import('../../../apps/web/src/client/presentation/appearance-project');
    const animated = await (await fetch(new URL('models/voxel-settler-animated.glb', base))).blob();
    const plain = await (await fetch(new URL('assets/samples/static-crate.glb', base))).blob();
    const project = createEmptyAppearanceProject();
    const initial = await store.loadAppearanceProject();
    const previous = await store.saveAppearanceProject(project, initial.revision, true, [
      { id: 'shared', name: '共享角色.glb', revision: 1, blob: animated },
      { id: 'alpha', name: '上一版模型.glb', revision: 1, blob: plain },
    ]);
    await store.saveAppearanceProject(project, previous.revision, true, [
      { id: 'shared', name: '共享角色.glb', revision: 2, blob: plain },
      { id: 'beta', name: '当前版模型.glb', revision: 1, blob: plain },
    ]);
  });
  await page.reload();
  await page.getByRole('button', { name: /共享角色.glb/ }).click();
  await expect(page.getByText('此模型没有动画片段，继续按旧静态 GLB 路径使用。')).toBeVisible();
  await expect(page.getByRole('button', { name: /当前版模型.glb/ })).toBeVisible();
  await page.getByRole('button', { name: '恢复上一个应用版本', exact: true }).click();
  await expect(page.getByText('已恢复上一个已应用外观；下次进入世界生效。')).toBeVisible();
  await expect(page.getByRole('button', { name: /上一版模型.glb/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /当前版模型.glb/ })).toHaveCount(0);
  await page.getByRole('button', { name: /共享角色.glb/ }).click();
  await expect(page.getByText('1 套 skin · 4 个片段')).toBeVisible();
  await expect(page.getByLabel('预览动画片段', { exact: true })).toHaveValue('Attack');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText('草稿已保存到此浏览器，游戏外观尚未改变。')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出完整项目', exact: true }).click();
  const exported = await download;
  expect(exported.suggestedFilename()).toBe('seedlands-appearance-project.json');
  const exportPath = await exported.path();
  if (!exportPath) throw new Error('外观包未下载到本地');
  const exportedPackage: unknown = JSON.parse(await readFile(exportPath, 'utf8'));
  expect(exportedPackage).toMatchObject({
    models: expect.arrayContaining([
      expect.objectContaining({ id: 'shared', revision: 1 }),
      expect.objectContaining({ id: 'alpha', revision: 1 }),
    ]),
  });
  await expect(page.getByText('已导出完整外观项目包。')).toBeVisible();
});

test('真实IndexedDB保持动画引用完整，并冻结启动时的模型Blob', async ({ page }) => {
  await page.goto('asset-workbench.html');
  await expect(page.locator('.viewport')).toHaveAttribute('data-ready', 'true');
  const result = await page.evaluate(async () => {
    const base = new URL('.', location.href);
    const storePath = new URL('src/client/persistence/appearance-project-store.ts', base).href;
    const projectPath = new URL('src/client/presentation/appearance-project.ts', base).href;
    const glbPath = new URL('src/client/presentation/glb-model.ts', base).href;
    const store = (await import(
      storePath
    )) as typeof import('../../../apps/web/src/client/persistence/appearance-project-store');
    const { createEmptyAppearanceProject } = (await import(
      projectPath
    )) as typeof import('../../../apps/web/src/client/presentation/appearance-project');
    const { validateStaticGlb } = (await import(
      glbPath
    )) as typeof import('../../../apps/web/src/client/presentation/glb-model');
    const blob = await (await fetch(new URL('models/voxel-settler-animated.glb', base))).blob();
    const project = {
      ...createEmptyAppearanceProject(),
      animationBindings: { settler: { modelId: 'actor', clips: { idle: 'Idle', attack: 'Attack' } } },
    };
    const models = [{ id: 'actor', name: '角色.glb', revision: 1, blob }];
    const initial = await store.loadAppearanceProject();
    let missingRejected = false;
    try {
      await store.saveAppearanceProject(project, initial.revision, true, []);
    } catch {
      missingRejected = true;
    }
    const first = await store.saveAppearanceProject(project, initial.revision, true, models);
    await store.saveAppearanceProject(project, first.revision, true, models);
    const frozen = await store.loadAppearanceProjectSnapshot();
    const staticBlob = await (await fetch(new URL('assets/samples/static-crate.glb', base))).blob();
    let reimportRejected = false;
    try {
      await store.reimportAppearanceModel('actor', new File([staticBlob], '静态替换.glb'), 1);
    } catch {
      reimportRejected = true;
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const jsonLength = new DataView(bytes.buffer).getUint32(12, true);
    const jsonText = new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength));
    const marker = jsonText.indexOf('Blender');
    if (marker < 0) throw new Error('Missing generator fixture marker');
    bytes[20 + marker] = 'S'.charCodeAt(0);
    await store.reimportAppearanceModel('actor', new File([bytes], '角色新版本.glb'), 1);
    const draftModels = await store.loadAppearanceModelBlobs();
    const beforeApply = await store.loadAppearanceProjectSnapshot();
    const unappliedPreserved = draftModels[0].revision === 2 && beforeApply.models[0].revision === 1;
    const applied = await store.saveAppearanceProject(project, beforeApply.state.revision, true, draftModels);
    const afterApply = await store.loadAppearanceProjectSnapshot();
    const appliedChanged = afterApply.models[0].revision === 2;
    await store.restoreAppearanceProject(applied.revision, 'previous');
    const beforeDelete = await store.loadAppearanceProjectSnapshot();
    const currentModels = await store.loadAppearanceModelBlobs();
    await store.deleteAppearanceModel('actor', currentModels[0].revision);
    const current = await store.loadAppearanceProjectSnapshot();
    const plain = createEmptyAppearanceProject();
    const versionA = await store.saveAppearanceProject(plain, current.state.revision, true, [
      { ...models[0], id: 'alpha' },
    ]);
    const versionB = await store.saveAppearanceProject(plain, versionA.revision, true, [{ ...models[0], id: 'beta' }]);
    await store.restoreAppearanceProject(versionB.revision, 'previous');
    const restored = await store.loadAppearanceProjectSnapshot();
    const separatePools =
      restored.models.map((model) => model.id).join(',') === 'alpha' &&
      restored.state.previousModels.map((model) => model.id).join(',') === 'beta' &&
      (await store.loadAppearanceModelBlobs()).map((model) => model.id).join(',') === 'alpha';
    return {
      separatePools,
      unappliedPreserved,
      appliedChanged,
      missingRejected,
      reimportRejected,
      retainedRevision: beforeDelete.models[0].revision,
      deleted: current.models.length === 0,
      cleared: [current.state.draft, current.state.applied, current.state.previous].every(
        (value) => Object.keys(value?.animationBindings ?? {}).length === 0,
      ),
      frozenBound: frozen.state.applied.animationBindings?.settler?.modelId,
      frozenClips: validateStaticGlb(await frozen.models[0].blob.arrayBuffer()).animationClips.map((clip) => clip.name),
    };
  });
  expect(result).toEqual({
    separatePools: true,
    unappliedPreserved: true,
    appliedChanged: true,
    missingRejected: true,
    reimportRejected: true,
    retainedRevision: 1,
    deleted: true,
    cleared: true,
    frozenBound: 'actor',
    frozenClips: ['Attack', 'Hurt', 'Idle', 'Walk'],
  });
});
