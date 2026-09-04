import { expect, test, type Page } from '@playwright/test';
import { snapshot, waitForSnapshot } from '../../../tests/e2e/support/harness';

type HarnessWindow = Window & {
  __seedlandsHarness?: {
    setVoxelAt: (x: number, y: number, z: number, voxel: number) => void;
    flushSave: () => Promise<void>;
    setSpectatorPosition: (x: number, y: number, z: number) => void;
    setView: (yaw: number, pitch: number) => void;
    fillWorld: (command: { from: [number, number, number]; to: [number, number, number]; voxel: number }) => void;
  };
};

async function startQualityWorld(page: Page, quality: 'low' | 'medium' | 'high', seed: string) {
  await page.goto('./?harness=1', { waitUntil: 'networkidle' });
  await page.locator('#quality').selectOption(quality);
  await page.locator('#seed').fill(seed);
  await page.getByRole('button', { name: '进入世界' }).click();
  await page.locator('#start-card').waitFor({ state: 'hidden' });
  await page.locator('#debug').waitFor({ state: 'visible', timeout: 15_000 });
  return waitForSnapshot(page, (current) => current.loadedChunks > 0 && current.meshingQueue === 0);
}

async function setVoxel(page: Page, x: number, y: number, z: number, voxel: number) {
  await page.evaluate(
    ([targetX, targetY, targetZ, value]) => {
      const harness = (window as HarnessWindow).__seedlandsHarness;
      if (!harness) throw new Error('高级光影 Harness 不可用。');
      harness.setVoxelAt(targetX, targetY, targetZ, value);
    },
    [x, y, z, voxel] as const,
  );
}

test('Medium 灯笼激活有界局部灯并通过正式存档路径恢复', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text());
  });
  const loaded = await startQualityWorld(page, 'medium', 'advanced-lighting-medium');
  expect(loaded.visualEffects).toMatchObject({
    localLightLimit: 4,
    localShadowLimit: 1,
    sunShadows: true,
    sunShadowResolution: 512,
    reflectionEnabled: true,
    reflectionResolution: 128,
    reflectionFrameInterval: 8,
    postProcessing: true,
  });
  const [x, y, z] = loaded.player.map(Math.floor) as [number, number, number];
  await setVoxel(page, x + 2, y, z, 9);
  const illuminated = await waitForSnapshot(
    page,
    (current) => current.visualEffects.activeLocalLights === 1 && current.visualEffects.shadowedLocalLights === 1,
  );
  expect(illuminated.visualEffects.activeLocalLights).toBeLessThanOrEqual(illuminated.visualEffects.localLightLimit);
  await setVoxel(page, 0, 0, 0, 9);
  await page.evaluate(() => (window as HarnessWindow).__seedlandsHarness?.flushSave());
  await page.screenshot({ path: testInfo.outputPath('medium-lantern.png') });

  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#quality').selectOption('medium');
  await page.locator('#seed').fill('advanced-lighting-medium');
  await page.getByRole('button', { name: '进入世界' }).click();
  const restored = await waitForSnapshot(page, (current) => current.loadedChunks > 0 && current.voxelAtOrigin === 9);
  expect(restored.voxelAtOrigin).toBe(9);
  expect(errors).toEqual([]);
});

test('High 水面反射相机按固定分辨率与帧间隔更新真实场景纹理', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text());
  });
  const loaded = await startQualityWorld(page, 'high', 'advanced-lighting-high');
  const [x, y, z] = loaded.player.map(Math.floor) as [number, number, number];
  await page.evaluate(
    ({ x: centerX, y: centerY, z: centerZ }) => {
      const harness = (window as HarnessWindow).__seedlandsHarness!;
      harness.fillWorld({
        from: [centerX - 5, centerY - 2, centerZ - 5],
        to: [centerX + 5, centerY - 2, centerZ + 5],
        voxel: 8,
      });
      harness.fillWorld({
        from: [centerX - 5, centerY - 1, centerZ - 5],
        to: [centerX + 5, centerY + 4, centerZ + 5],
        voxel: 0,
      });
      harness.setSpectatorPosition(centerX + 0.5, centerY + 3.5, centerZ + 4.5);
      harness.setView(0, -42);
    },
    { x, y, z },
  );
  const reflected = await waitForSnapshot(
    page,
    (current) =>
      current.visualEffects.reflectionActive &&
      current.visualEffects.reflectionRenderCount > 0 &&
      current.mutationCount > 0 &&
      current.remeshSchedulingCount > 0 &&
      current.deferredRemeshes === 0 &&
      current.generationQueue === 0 &&
      current.meshingQueue === 0 &&
      current.performance.uploadQueueDepth === 0,
  );
  expect(reflected.visualEffects).toMatchObject({
    sunShadowResolution: 1024,
    localLightLimit: 6,
    localShadowLimit: 2,
    reflectionEnabled: true,
    reflectionResolution: 256,
    reflectionFrameInterval: 4,
    postProcessing: true,
  });
  expect(reflected.visualEffects.waterPlaneY).toBe(y - 1);
  await page.screenshot({ path: testInfo.outputPath('high-planar-reflection.png') });
  expect(errors).toEqual([]);
});

test('Low 完全关闭反射、后处理与阴影但仍保留有界人工光源', async ({ page }) => {
  const loaded = await startQualityWorld(page, 'low', 'advanced-lighting-low');
  expect(loaded.visualEffects).toMatchObject({
    localLightLimit: 2,
    localShadowLimit: 0,
    sunShadows: false,
    sunShadowResolution: 0,
    reflectionEnabled: false,
    reflectionActive: false,
    reflectionResolution: 0,
    reflectionFrameInterval: 0,
    postProcessing: false,
  });
  const [x, y, z] = loaded.player.map(Math.floor) as [number, number, number];
  await setVoxel(page, x + 2, y, z, 9);
  const lit = await waitForSnapshot(page, (current) => current.visualEffects.activeLocalLights === 1);
  expect(lit.visualEffects.shadowedLocalLights).toBe(0);
  expect((await snapshot(page))?.quality).toBe('low');
});
