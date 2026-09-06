import { expect, test, type Page } from '@playwright/test';
import type { HarnessApi } from '../../../src/app/game-harness';
import { lockPointer, startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

const snapshot = (page: Page) => page.evaluate(() => (window.__seedlandsHarness as unknown as HarnessApi).snapshot());

test.use({ video: 'on' });

test('水岸低顶阻止真实Space跃出，不能越过碰撞净空', async ({ page }, testInfo) => {
  await startHarnessWorld(page, 'authority-low-bank-ceiling');
  await page.evaluate(async () => {
    const h = window.__seedlandsHarness as unknown as HarnessApi;
    await h.fillWorld({ from: [-2, 48, -3], to: [2, 48, 3], voxel: 3 });
    await h.fillWorld({ from: [-2, 49, -3], to: [2, 53, 3], voxel: 0 });
    await h.fillWorld({ from: [-2, 49, 0], to: [2, 49, 0], voxel: 3 });
    await h.fillWorld({ from: [-2, 49, 1], to: [2, 49, 3], voxel: 8 });
    await h.fillWorld({ from: [-2, 51, -1], to: [2, 51, 3], voxel: 3 });
    await h.movePlayerTo(0.5, 50.6, 2.2);
    h.setView(0, 0);
  });
  await waitForSnapshot(page, (value) => !value.colliding && Math.abs(value.serverPlayerPosition[2] - 2.2) < 0.01);
  await lockPointer(page);
  const before = await snapshot(page);
  await page.keyboard.down('KeyW');
  await page.keyboard.down('Space');
  try {
    await expect
      .poll(async () => (await snapshot(page)).authority.physicsTick)
      .toBeGreaterThan(before.authority.physicsTick + 60);
  } finally {
    await page.keyboard.up('Space');
    await page.keyboard.up('KeyW');
  }
  const after = await snapshot(page);
  await testInfo.attach('geometry-final-frame', { body: await page.screenshot(), contentType: 'image/png' });
  const samples = after.trajectory.filter((item) => item.physicsTick > before.authority.physicsTick);
  await testInfo.attach('low-ceiling-authority-trajectory', {
    body: JSON.stringify(samples),
    contentType: 'application/json',
  });
  expect(samples.length).toBeGreaterThan(15);
  expect(Math.min(...samples.map((item) => item.position[2]))).toBeGreaterThanOrEqual(1.32 - 1e-4);
  expect(Math.max(...samples.map((item) => item.position[1]))).toBeLessThanOrEqual(50.8 + 1e-4);
  expect(after.colliding).toBe(false);
});

test('终端速度下落经过单层平台仍落在真实表面', async ({ page }, testInfo) => {
  await startHarnessWorld(page, 'authority-terminal-fall');
  await page.evaluate(async () => {
    const h = window.__seedlandsHarness as unknown as HarnessApi;
    await h.fillWorld({ from: [6, 47, -2], to: [10, 105, 2], voxel: 0 });
    await h.fillWorld({ from: [6, 48, -2], to: [10, 48, 2], voxel: 3 });
    await h.movePlayerTo(8.5, 100.6, 0.5);
  });
  await waitForSnapshot(page, (value) => value.serverPlayerPosition[1] > 98);
  const before = await snapshot(page);
  await waitForSnapshot(page, (value) => value.onGround && Math.abs(value.serverPlayerPosition[1] - 50.6) < 0.001);
  const after = await snapshot(page);
  await testInfo.attach('geometry-final-frame', { body: await page.screenshot(), contentType: 'image/png' });
  const samples = after.trajectory.filter((item) => item.physicsTick > before.authority.physicsTick);
  await testInfo.attach('terminal-fall-authority-trajectory', {
    body: JSON.stringify(samples),
    contentType: 'application/json',
  });
  const speeds = samples
    .slice(1)
    .map(
      (next, index) =>
        ((samples[index]!.position[1] - next.position[1]) * 60) / (next.physicsTick - samples[index]!.physicsTick),
    );
  expect(Math.max(...speeds)).toBeGreaterThan(23);
  expect(Math.max(...speeds)).toBeLessThanOrEqual(24 + 1e-4);
  expect(Math.min(...samples.map((item) => item.position[1]))).toBeGreaterThanOrEqual(50.6 - 1e-4);
  expect(after.colliding).toBe(false);
});

test('灯笼使用0.94格真实碰撞高度而不是整格模型包围盒', async ({ page }) => {
  await startHarnessWorld(page, 'authority-lantern-support');
  await page.evaluate(async () => {
    const h = window.__seedlandsHarness as unknown as HarnessApi;
    await h.fillWorld({ from: [-2, 48, -2], to: [2, 48, 2], voxel: 3 });
    await h.fillWorld({ from: [-2, 49, -2], to: [2, 55, 2], voxel: 0 });
    await h.setVoxelAt(0, 49, 0, 10);
    await h.movePlayerTo(0.5, 54.6, 0.5);
  });
  await waitForSnapshot(page, (value) => value.onGround && Math.abs(value.serverPlayerPosition[1] - 51.54) < 0.001);
  const after = await snapshot(page);
  expect(after.colliding).toBe(false);
  expect(after.serverPlayerPosition[1]).toBeCloseTo(49 + 0.94 + 1.6, 4);
});
