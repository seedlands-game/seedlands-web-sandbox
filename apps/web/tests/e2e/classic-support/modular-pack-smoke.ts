import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { observeBrowserRuntime } from './evidence';
import { browserArtifact, browserPackLock, compositionIdentity } from './identity';
import {
  clickCanvasCenter,
  closeInventory,
  lockPointer,
  snapshot,
  voxelAt,
  walkTo,
  waitForSnapshot,
  type ClassicWindow,
} from './harness';
import { aimAtVoxelWithRealMouse } from './aim';

export const modularPackSmokeEnabled = process.env.SEEDLANDS_PACK_SMOKE === 'modular-world';

export async function verifyModularPackSmoke({ page }: { page: Page }, testInfo: TestInfo) {
  test.skip(!modularPackSmokeEnabled, 'This smoke runs only against a modular-world production artifact.');
  test.setTimeout(90_000);
  const runtime = observeBrowserRuntime(page);
  await page.addInitScript(() => {
    localStorage.setItem('seedlands.audio.v1', JSON.stringify({ master: 0, music: 0, ambience: 0, sfx: 0, ui: 0 }));
  });
  await page.goto('./?harness=1&renderer=webgl2&wasm=on&simd=on', { waitUntil: 'networkidle' });
  await page.locator('#quality').selectOption('low');
  await page.locator('#seed').fill('modular-production-smoke');
  await page.getByRole('button', { name: '进入世界', exact: true }).click();
  await page.locator('#start-card').waitFor({ state: 'hidden' });
  const state = await waitForSnapshot(page, (value) => value.loadedChunks > 0 && value.renderedChunks > 0, 30_000);
  const [artifact, packLock, composition] = await Promise.all([
    browserArtifact(page),
    browserPackLock(page),
    compositionIdentity(page),
  ]);
  expect(artifact.ok).toBe(true);
  expect(packLock.lock?.packs).toContainEqual(
    expect.objectContaining({ id: 'sample:modular-world', version: '1.0.0' }),
  );
  expect(composition).toMatchObject({ playbookId: 'sample:modular-world' });
  expect(state).toMatchObject({ runtime: 'authority-worker', generatorVersion: 11, onGround: true });
  expect(state.compute.failedTasks).toBe(0);
  await expect.poll(() => voxelAt(page, [0, 64, 0])).toBe(500);
  // Move off the floor tile before mining it; the sample world has one floor layer.
  await lockPointer(page);
  const approach = await walkTo(page, [2.5, 0.5], { pulseMs: 80, timeout: 15_000 });
  await page.keyboard.press('KeyE');
  const survival = page.getByRole('dialog', { name: '背包与合成' });
  await expect(survival).toBeVisible();
  await survival.getByRole('button', { name: '切换创造模式', exact: true }).click();
  const catalog = page.getByRole('dialog', { name: '创造内容目录' });
  await expect(catalog).toBeVisible();
  await catalog.locator('#creative-item-filter').fill('哨兵玻璃');
  await catalog.getByRole('button', { name: /^将哨兵玻璃放入创造快捷栏 / }).click();
  await closeInventory(page);
  await expect(page.locator('#hotbar button[aria-pressed="true"]')).toHaveAttribute(
    'data-item',
    'sample:sentinel-glass',
  );
  const beforeActions = await snapshot(page);
  if (!beforeActions) throw new Error('Modular snapshot is unavailable before player block actions.');
  const miningAim = await aimAtVoxelWithRealMouse(page, [0, 64, 0]);
  await clickCanvasCenter(page, 'left');
  await expect.poll(() => voxelAt(page, [0, 64, 0])).toBe(0);
  const mined = await waitForSnapshot(page, (value) => value.worldRevision > beforeActions.worldRevision);
  await expect.poll(() => voxelAt(page, [0, 65, 1])).toBe(0);
  const placementAim = await aimAtVoxelWithRealMouse(page, [0, 64, 1], [0, 65, 1]);
  await clickCanvasCenter(page, 'right');
  await expect.poll(() => voxelAt(page, [0, 65, 1])).toBe(500);
  const placed = await waitForSnapshot(page, (value) => value.worldRevision > mined.worldRevision);
  await page.evaluate(async () => {
    await (window as unknown as ClassicWindow).__seedlandsHarness!.flushSave();
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#seed').fill('modular-production-smoke');
  await page.getByRole('button', { name: '进入世界', exact: true }).click();
  await page.locator('#start-card').waitFor({ state: 'hidden' });
  await waitForSnapshot(page, (value) => value.loadedChunks > 0 && value.renderedChunks > 0, 30_000);
  await expect.poll(() => voxelAt(page, [0, 64, 0])).toBe(0);
  await expect.poll(() => voxelAt(page, [0, 65, 1])).toBe(500);
  expect(runtime.pageErrors).toEqual([]);
  expect(runtime.failedResponses).toEqual([]);
  await testInfo.attach('modular-pack-smoke.json', {
    contentType: 'application/json',
    body: JSON.stringify({
      artifact,
      packLock,
      composition,
      customVoxel: 500,
      persistedVoxel: 0,
      persistedPlacedVoxel: 500,
      approach,
      miningAim,
      placementAim,
      worldRevisions: [beforeActions.worldRevision, mined.worldRevision, placed.worldRevision],
    }),
  });
  await page.evaluate(async () => {
    const harness = (window as unknown as ClassicWindow).__seedlandsHarness!;
    await harness.setVoxelAt(0, 64, 0, 500);
    await harness.setVoxelAt(0, 65, 1, 0);
    await harness.flushSave();
  });
}
