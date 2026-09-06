import { expect, test } from '@playwright/test';
import { snapshot, waitForSnapshot } from '../../../tests/e2e/support/harness';

test('不透明墙后的水体不能覆盖前景墙面', async ({ page }, testInfo) => {
  await page.goto('./?harness=1');
  await page.locator('#quality').selectOption('high');
  await page.locator('#seed').fill('water-depth-occlusion');
  await page.getByRole('button', { name: '进入世界', exact: true }).click();
  await waitForSnapshot(page, (s) => s.onGround && !s.colliding);
  await page.evaluate(() => {
    const h = window.__seedlandsHarness!;
    h.fillWorld({ from: [35, 26, 35], to: [45, 36, 46], voxel: 0 });
    h.fillWorld({ from: [35, 26, 41], to: [45, 36, 41], voxel: 4 });
    h.setSpectatorPosition(40.5, 32, 46);
    h.setView(0, -12);
    h.setWorldTime(10);
    h.setTimePaused(true);
  });
  await waitForSnapshot(
    page,
    (s) => s.generationQueue === 0 && s.meshingQueue === 0 && s.performance.uploadQueueDepth === 0,
  );
  await expect(page.locator('#world-clock')).toContainText('10:00');
  const clip = { x: 520, y: 350, width: 240, height: 140 };
  const before = await page.screenshot({ clip });
  await page.evaluate(() => window.__seedlandsHarness!.fillWorld({ from: [35, 30, 35], to: [45, 31, 39], voxel: 8 }));
  const rendered = await waitForSnapshot(
    page,
    (s) =>
      s.generationQueue === 0 &&
      s.meshingQueue === 0 &&
      s.performance.uploadQueueDepth === 0 &&
      s.visualEffects.reflectionActive,
  );
  await expect
    .poll(async () => (await snapshot(page))!.visualEffects.reflectionRenderCount)
    .toBeGreaterThan(rendered.visualEffects.reflectionRenderCount + 2);
  await page.screenshot({ path: testInfo.outputPath('occlusion-full.png') });
  const after = await page.screenshot({ clip });
  await testInfo.attach('wall-without-water', { body: before, contentType: 'image/png' });
  await testInfo.attach('wall-with-water-behind', { body: after, contentType: 'image/png' });
  expect(after.equals(before), '水在不透明墙后，前景像素不得被水层改写').toBe(true);
});
