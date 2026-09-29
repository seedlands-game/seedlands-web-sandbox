import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { observeBrowserRuntime } from './evidence';
import { browserArtifact, browserPackLock, compositionIdentity } from './identity';
import { voxelAt, waitForSnapshot, type ClassicWindow } from './harness';

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
  await page.evaluate(async () => {
    const harness = (window as unknown as ClassicWindow).__seedlandsHarness!;
    await harness.setVoxelAt(0, 64, 0, 0);
    await harness.flushSave();
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#seed').fill('modular-production-smoke');
  await page.getByRole('button', { name: '进入世界', exact: true }).click();
  await page.locator('#start-card').waitFor({ state: 'hidden' });
  await waitForSnapshot(page, (value) => value.loadedChunks > 0 && value.renderedChunks > 0, 30_000);
  await expect.poll(() => voxelAt(page, [0, 64, 0])).toBe(0);
  expect(runtime.pageErrors).toEqual([]);
  expect(runtime.failedResponses).toEqual([]);
  await testInfo.attach('modular-pack-smoke.json', {
    contentType: 'application/json',
    body: JSON.stringify({ artifact, packLock, composition, customVoxel: 500, persistedVoxel: 0 }),
  });
  await page.evaluate(async () => {
    const harness = (window as unknown as ClassicWindow).__seedlandsHarness!;
    await harness.setVoxelAt(0, 64, 0, 500);
    await harness.flushSave();
  });
}
