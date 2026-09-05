import { expect, test, type Page } from '@playwright/test';
import { lockPointer, startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

type RepairHarness = Window & {
  __seedlandsHarness?: {
    fillWorld: (command: { from: [number, number, number]; to: [number, number, number]; voxel: number }) => void;
    setVoxelAt: (x: number, y: number, z: number, voxel: number) => void;
    setSpectatorPosition: (x: number, y: number, z: number) => void;
    setView: (yaw: number, pitch: number) => void;
    setWorldTime: (hour: number) => void;
    setTimePaused: (paused: boolean) => void;
    getVoxelAt: (x: number, y: number, z: number) => number | null;
    flushSave: () => Promise<void>;
    snapshot: () => {
      breakingOverlay: { position: [number, number, number]; stage: number } | null;
      viewmodel: { isolatedLayer: boolean };
      visualEffects: { activeLocalLights: number; shadowUpdateCount: number; shadowStableFrameCount: number };
      meshingQueue: number;
      deferredRemeshes: number;
      generationQueue: number;
      colliding: boolean;
    };
  };
};

async function prepareCave(page: Page) {
  await page.evaluate(() => {
    const harness = (window as RepairHarness).__seedlandsHarness!;
    harness.fillWorld({ from: [-12, 48, -14], to: [12, 55, 4], voxel: 3 });
    harness.fillWorld({ from: [-11, 49, -13], to: [11, 54, 3], voxel: 0 });
    harness.setVoxelAt(0, 49, -5, 10);
    harness.setSpectatorPosition(0.5, 51.2, 1.5);
    harness.setView(0, -8);
    harness.setWorldTime(3);
    harness.setTimePaused(true);
  });
  await waitForSnapshot(
    page,
    (current) =>
      current.meshingQueue === 0 &&
      current.deferredRemeshes === 0 &&
      current.generationQueue === 0 &&
      current.visualEffects.activeLocalLights === 1 &&
      current.visualEffects.shadowStableFrameCount >= 2,
  );
}

test('灯笼以模型方块照亮洞穴且静止阴影不重复更新', async ({ page }, testInfo) => {
  await page.goto('./?harness=1');
  await page.locator('#quality').selectOption('high');
  await page.locator('#seed').fill('lantern-model-shadow-stability');
  await page.getByRole('button', { name: '进入世界' }).click();
  await page.locator('#start-card').waitFor({ state: 'hidden' });
  await prepareCave(page);
  const stable = await page.evaluate(async () => {
    const harness = (window as RepairHarness).__seedlandsHarness!;
    const counts: number[] = [];
    for (let frame = 0; frame < 12; frame += 1) {
      counts.push(harness.snapshot().visualEffects.shadowUpdateCount);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    const last = harness.snapshot();
    return { counts, last };
  });
  expect(stable.last.visualEffects.activeLocalLights).toBe(1);
  expect(new Set(stable.counts).size).toBe(1);
  expect(stable.last.visualEffects.shadowStableFrameCount).toBeGreaterThanOrEqual(2);
  await page.locator('#game').screenshot({ path: testInfo.outputPath('shadow-frame-a.png') });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.locator('#game').screenshot({ path: testInfo.outputPath('shadow-frame-b.png') });
  await page.screenshot({ path: testInfo.outputPath('model-lantern-stable-shadow.png') });
  await page.evaluate(() => (window as RepairHarness).__seedlandsHarness!.flushSave());
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '进入世界' }).click();
  await page.locator('#debug').waitFor({ state: 'visible', timeout: 15_000 });
  await expect
    .poll(() => page.evaluate(() => (window as RepairHarness).__seedlandsHarness?.getVoxelAt(0, 49, -5)))
    .toBe(10);
});

test('真实按住采集显示方块裂纹并在松开后清除', async ({ page }, testInfo) => {
  await startHarnessWorld(page, 'break-overlay-real-input');
  await page.evaluate(() => {
    const harness = (window as RepairHarness).__seedlandsHarness!;
    harness.fillWorld({ from: [-1, 48, -5], to: [1, 48, 1], voxel: 3 });
    harness.fillWorld({ from: [-1, 49, -5], to: [1, 52, 1], voxel: 0 });
    harness.setVoxelAt(0, 50, -3, 3);
    harness.setSpectatorPosition(0.5, 50.5, 0.5);
    harness.setView(0, 0);
  });
  await waitForSnapshot(
    page,
    (current) =>
      current.generationQueue === 0 &&
      current.meshingQueue === 0 &&
      current.deferredRemeshes === 0 &&
      current.renderedChunks > 0,
  );
  const canvas = await lockPointer(page);
  await canvas.dispatchEvent('mousedown', { button: 0 });
  await page.waitForFunction(
    () => (window as RepairHarness).__seedlandsHarness?.snapshot().breakingOverlay?.stage === 0,
  );
  await page.waitForFunction(
    () => ((window as RepairHarness).__seedlandsHarness?.snapshot().breakingOverlay?.stage ?? 0) >= 2,
  );
  const overlay = await page.evaluate(() => (window as RepairHarness).__seedlandsHarness!.snapshot().breakingOverlay);
  expect(overlay?.position).toEqual([0, 50, -3]);
  await page.screenshot({ path: testInfo.outputPath('block-break-overlay.png') });
  await canvas.dispatchEvent('mouseup', { button: 0 });
  await page.waitForFunction(() => (window as RepairHarness).__seedlandsHarness?.snapshot().breakingOverlay === null);
  await expect(page.locator('#break-progress')).toHaveCount(0);
});

test('灯笼格边空隙可通过而模型主体会阻挡玩家', async ({ page }) => {
  await startHarnessWorld(page, 'lantern-collision-box');
  await page.evaluate(() => {
    const harness = (window as RepairHarness).__seedlandsHarness!;
    harness.fillWorld({ from: [-2, 48, -2], to: [2, 48, 2], voxel: 3 });
    harness.fillWorld({ from: [-2, 49, -2], to: [2, 52, 2], voxel: 0 });
    harness.setVoxelAt(0, 49, 0, 10);
    harness.setSpectatorPosition(1.1, 50.61, 0.5);
  });
  await expect
    .poll(() => page.evaluate(() => (window as RepairHarness).__seedlandsHarness!.snapshot().colliding))
    .toBe(false);
  await page.evaluate(() => (window as RepairHarness).__seedlandsHarness!.setSpectatorPosition(0.9, 50.61, 0.5));
  await expect
    .poll(() => page.evaluate(() => (window as RepairHarness).__seedlandsHarness!.snapshot().colliding))
    .toBe(true);
});

test('超宽贴墙镜头中的第一人称模型使用隔离层且不被切断', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1920, height: 1020 });
  await startHarnessWorld(page, 'viewmodel-wall-wide');
  await page.evaluate(() => {
    const harness = (window as RepairHarness).__seedlandsHarness!;
    harness.fillWorld({ from: [-2, 48, -2], to: [2, 52, -1], voxel: 3 });
    harness.setSpectatorPosition(0.5, 50.4, 0.15);
    harness.setView(0, 0);
  });
  await waitForSnapshot(
    page,
    (current) =>
      current.generationQueue === 0 &&
      current.meshingQueue === 0 &&
      current.deferredRemeshes === 0 &&
      current.renderedChunks > 0,
  );
  const snapshot = await page.evaluate(() => (window as RepairHarness).__seedlandsHarness!.snapshot());
  expect(snapshot.viewmodel).toEqual({ isolatedLayer: true });
  await expect(page.locator('#crosshair')).toBeVisible();
  await expect(page.locator('#hotbar')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('wide-wall-viewmodel.png') });
});
