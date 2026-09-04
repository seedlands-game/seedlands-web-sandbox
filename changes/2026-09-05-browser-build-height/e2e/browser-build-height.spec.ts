import { expect, test } from '@playwright/test';
import { lockPointer, snapshot, startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

test('超出浏览器可见高度的放置有反馈且不消耗物品', async ({ page }) => {
  await startHarnessWorld(page, 'browser-build-height');
  await page.evaluate(async () => {
    const h = window.__seedlandsHarness!;
    h.fillWorld({ from: [-2, 62, -3], to: [2, 62, 2], voxel: 3 });
    h.setVoxelAt(0, 63, -2, 4);
    h.movePlayerTo(0.5, 64.6, 0.5);
    const result = await h.executeGameplayCommand({ type: 'give-item', itemId: 'stone-block', count: 1 });
    if (!result.success) throw new Error('测试材料准备失败');
  });
  await waitForSnapshot(
    page,
    (s) => s.onGround && !s.colliding && s.meshingQueue === 0 && s.performance.uploadQueueDepth === 0,
  );
  await expect(page.getByRole('button', { name: '选择石块 1', exact: true })).toBeVisible();
  await lockPointer(page);
  await page.evaluate(() => window.__seedlandsHarness!.setView(0, (-Math.atan2(0.601, 2) * 180) / Math.PI));
  const before = (await snapshot(page))!.worldRevision;
  await page.mouse.click(640, 360, { button: 'right' });
  await expect(page.getByRole('status', { name: '交互反馈', exact: true })).toContainText('建造高度');
  expect((await snapshot(page))!.worldRevision).toBe(before);
  await page.keyboard.press('KeyE');
  await expect(page.getByRole('gridcell', { name: '石块 1', exact: true })).toBeVisible();
});
