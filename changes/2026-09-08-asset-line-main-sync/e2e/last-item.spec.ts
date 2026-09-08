import { expect, test } from '@playwright/test';
import { lockPointer, startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';
const probe = '/changes/2026-09-08-asset-line-main-sync/e2e/gesture-probe.ts';

test('真实右键放置最后一盏灯笼后，空手完成动作并回位', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startHarnessWorld(page, 'mosslight-68');
  await waitForSnapshot(page, (state) => state.onGround && state.renderedChunks > 0);
  await page.evaluate(async () => {
    const h = window.__seedlandsHarness!;
    await h.fillWorld({ from: [-4, 57, -2], to: [4, 57, 5], voxel: 3 });
    await h.fillWorld({ from: [-4, 58, -2], to: [4, 63, 5], voxel: 0 });
    await h.setVoxelAt(0, 58, 0, 3);
    await h.executeGameplayCommand({ type: 'give-item', itemId: 'lantern', count: 1 });
    await h.movePlayerTo(0.5, 59.62, 4);
    h.setView(0, -15);
  });
  await waitForSnapshot(page, (state) => state.onGround && state.generationQueue === 0 && state.meshingQueue === 0);
  await page.keyboard.press('KeyE');
  const slot = Number(await page.getByRole('gridcell', { name: '灯笼 1', exact: true }).getAttribute('data-slot'));
  await page.getByRole('button', { name: '关闭背包', exact: true }).click();
  await page.keyboard.press(`Digit${slot + 1}`);
  await lockPointer(page);
  await page.evaluate(async (path) => ((await import(path)) as typeof import('./gesture-probe')).begin(), probe);
  await page.mouse.click(640, 360, { button: 'right' });
  await expect
    .poll(
      async () =>
        page.evaluate(
          async (path) => ((await import(path)) as typeof import('./gesture-probe')).read().movingEmptyFrames,
          probe,
        ),
      { intervals: [10] },
    )
    .toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath('last-lantern-early.jpg'), type: 'jpeg' });
  await page.waitForTimeout(80);
  await page.screenshot({ path: info.outputPath('last-lantern-middle.jpg'), type: 'jpeg' });
  await expect
    .poll(async () =>
      page.evaluate(async (path) => ((await import(path)) as typeof import('./gesture-probe')).read().settled, probe),
    )
    .toBe(true);
  const result = await page.evaluate(
    async (path) => ((await import(path)) as typeof import('./gesture-probe')).read(),
    probe,
  );
  expect(result.movingEmptyFrames).toBeGreaterThan(2);
  await page.screenshot({ path: info.outputPath('last-lantern-rest.jpg'), type: 'jpeg' });
  await page.keyboard.press('KeyE');
  await expect(page.getByRole('gridcell', { name: '灯笼 1', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
