import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { prepareFlatMovement, setHarnessView, startHarnessWorld } from '../../../tests/e2e/support/harness';

test('真实骨骼GLB片段可预览，绑定保存后应用到游戏', async ({ page, context }, info) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('asset-workbench.html');
  await expect(page.locator('.viewport')).toHaveAttribute('data-ready', 'true');
  const buffer = await readFile(new URL('../../../apps/web/public/models/voxel-settler-animated.glb', import.meta.url));
  await page.getByLabel('导入静态 GLB', { exact: true }).setInputFiles({
    name: '骨骼角色.glb',
    mimeType: 'model/gltf-binary',
    buffer,
  });
  await expect(page.getByRole('heading', { name: '骨骼角色.glb', level: 1, exact: true })).toBeVisible();
  await expect(page.locator('.viewport')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByText('1 套 skin · 4 个片段')).toBeVisible();
  await page.getByLabel('预览动画片段', { exact: true }).selectOption('Attack');
  const canvas = page.getByLabel('3D 资产预览，拖动旋转，滚轮缩放', { exact: true });
  const early = await canvas.screenshot({ path: info.outputPath('skin-attack-early.png') });
  await page.waitForTimeout(200);
  const middle = await canvas.screenshot({ path: info.outputPath('skin-attack-middle.png') });
  await page.waitForTimeout(250);
  const late = await canvas.screenshot({ path: info.outputPath('skin-attack-late.png') });
  expect(early.equals(middle), '静止摄像机下骨骼片段需要产生可见变化').toBe(false);
  expect(middle.equals(late), '片段继续播放应出现第三个姿态').toBe(false);
  await page.getByLabel('动画应用对象', { exact: true }).selectOption('settler');
  for (const [role, clip] of Object.entries({ idle: 'Idle', move: 'Walk', attack: 'Attack', hurt: 'Hurt' })) {
    await page.getByLabel(`${role} 动画片段`, { exact: true }).selectOption(clip);
  }
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await page.getByRole('button', { name: '应用到游戏', exact: true }).click();
  await expect(page.getByText(/已应用外观快照/)).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await page.getByRole('button', { name: /骨骼角色.glb/ }).click();
  await page.getByLabel('动画应用对象', { exact: true }).selectOption('settler');
  await expect(page.getByLabel('attack 动画片段', { exact: true })).toHaveValue('Attack');
  await expect(page.getByLabel('move 动画片段', { exact: true })).toHaveValue('Walk');
  const game = await context.newPage();
  game.on('pageerror', (error) => errors.push(error.message));
  await startHarnessWorld(game, 'animated-settler');
  await prepareFlatMovement(game);
  const created = await game.evaluate(async () => {
    return window.__seedlandsHarness!.executeGameplayCommand({
      type: 'spawn-actor',
      archetype: 'settler',
      position: [0.5, 57, -3],
    });
  });
  expect(created.success).toBe(true);
  if (!created.success) throw new Error('固定场景居民创建失败');
  const entityId = (created.data as { entity: { id: string } }).entity.id;
  await setHarnessView(game, 0, -13);
  await expect(game.locator(`[data-entity-id="${entityId}"]`)).toBeAttached();
  await game.waitForTimeout(1000);
  await game.screenshot({ path: info.outputPath('applied-skinned-settler.png') });
  expect(errors).toEqual([]);
});
