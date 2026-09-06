import { expect, test, type Page } from '@playwright/test';
import type { HarnessApi } from '../../../src/app/game-harness';
import { lockPointer, startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

const state = (page: Page) => page.evaluate(() => (window.__seedlandsHarness as unknown as HarnessApi).snapshot());

test.use({ video: 'on' });

test('真实连续跳搭后按住左键下挖，落在薄平台且全程无身体重叠', async ({ page }, testInfo) => {
  await startHarnessWorld(page, 'authority-jump-build-excavate');
  await page.evaluate(async () => {
    const h = window.__seedlandsHarness as unknown as HarnessApi;
    await h.fillWorld({ from: [-2, 48, -2], to: [2, 48, 2], voxel: 3 });
    await h.fillWorld({ from: [-2, 49, -2], to: [2, 60, 2], voxel: 0 });
    const material = await h.executeGameplayCommand({ type: 'give-item', itemId: 'dirt-block', count: 8 });
    if (!material.success) throw new Error(material.error.message);
    await h.movePlayerTo(0.5, 50.6, 0.5);
    h.setView(0, -89);
  });
  await waitForSnapshot(page, (s) => s.onGround && !s.colliding && Math.abs(s.serverPlayerPosition[1] - 50.6) < 0.001);
  await page.getByRole('button', { name: '选择泥土块 8', exact: true }).click();
  await lockPointer(page);
  const before = await state(page);
  await page.keyboard.down('Space');
  try {
    for (const y of [49, 50]) {
      await page.waitForFunction(
        (surface) =>
          (window.__seedlandsHarness as unknown as HarnessApi).snapshot().serverPlayerPosition[1] >
          surface + 1.6 + 0.025,
        y + 1,
      );
      const placementState = await state(page);
      await page.mouse.click(640, 360, { button: 'right' });
      await testInfo.attach(`placement-${y}`, {
        body: JSON.stringify({
          before: placementState,
          after: await state(page),
          feedback: await page.getByRole('status', { name: '交互反馈', exact: true }).textContent(),
        }),
        contentType: 'application/json',
      });
      await expect
        .poll(() =>
          page.evaluate((height) => (window.__seedlandsHarness as unknown as HarnessApi).getVoxelAt!(0, height, 0), y),
        )
        .toBe(2);
    }
  } finally {
    await page.keyboard.up('Space');
  }
  await waitForSnapshot(page, (s) => s.onGround && Math.abs(s.serverPlayerPosition[1] - 52.6) < 0.001);
  const built = await state(page);
  expect(built.colliding).toBe(false);
  await testInfo.attach('jump-building-landed', { body: await page.screenshot(), contentType: 'image/png' });

  await page.mouse.down({ button: 'left' });
  try {
    await page.waitForFunction(() => {
      const h = window.__seedlandsHarness as unknown as HarnessApi;
      return h.getVoxelAt!(0, 50, 0) === 0 && h.getVoxelAt!(0, 49, 0) === 0;
    });
  } finally {
    await page.mouse.up({ button: 'left' });
  }
  await waitForSnapshot(page, (s) => s.onGround && Math.abs(s.serverPlayerPosition[1] - 50.6) < 0.001);
  const landed = await state(page);
  expect(landed.colliding).toBe(false);
  expect(await page.evaluate(() => (window.__seedlandsHarness as unknown as HarnessApi).getVoxelAt!(0, 48, 0))).toBe(3);
  const trajectory = landed.trajectory.filter((sample) => sample.physicsTick > before.authority.physicsTick);
  expect(trajectory.length).toBeGreaterThan(30);
  for (let i = 1; i < trajectory.length; i++) {
    const previous = trajectory[i - 1]!,
      next = trajectory[i]!;
    const dt = (next.physicsTick - previous.physicsTick) / landed.authority.physicsHz;
    expect(Math.abs(next.position[1] - previous.position[1])).toBeLessThanOrEqual(24 * dt + 1e-4);
  }
  await testInfo.attach('jump-build-excavate-trajectory', {
    body: JSON.stringify({ before, built, landed, trajectory }),
    contentType: 'application/json',
  });
  await testInfo.attach('excavation-landed', { body: await page.screenshot(), contentType: 'image/png' });
});
