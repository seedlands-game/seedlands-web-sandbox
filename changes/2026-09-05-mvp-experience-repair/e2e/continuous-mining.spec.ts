import { expect, test } from '@playwright/test';
import { lockPointer, startHarnessWorld } from '../../../tests/e2e/support/harness';

test('一次按住左键连续采集两块，松开后停止下一块', async ({ page }) => {
  await startHarnessWorld(page, 'repair-mining');
  await page.evaluate(() => {
    const h = window.__seedlandsHarness!;
    h.setSpectatorPosition(0.5, 58.5, 0.5);
    h.setView(0, 0);
    for (let z = -1; z >= -4; z--) h.setVoxelAt(0, 58, z, 2);
  });
  await lockPointer(page);
  await page.mouse.down();
  const voxel = (z: number) =>
    page.evaluate(
      (targetZ) =>
        window.__seedlandsHarness!.executeGameplayCommand({ type: 'inspect-voxel', position: [0, 58, targetZ] }),
      z,
    );
  await expect.poll(() => voxel(-1), { timeout: 6000 }).toMatchObject({ success: true, data: { voxel: 0 } });
  await expect.poll(() => voxel(-2), { timeout: 6000 }).toMatchObject({ success: true, data: { voxel: 0 } });
  await page.mouse.up();
  await page.evaluate(() => window.__seedlandsHarness!.advanceGameplay(1));
  expect(await voxel(-3)).toMatchObject({ success: true, data: { voxel: 2 } });
});

for (const interrupt of ['inventory', 'pause', 'pointer-lock', 'death'] as const) {
  test(`按住采集中断：${interrupt} 后不继续破坏方块`, async ({ page }) => {
    await startHarnessWorld(page, `repair-mining-${interrupt}`);
    await page.evaluate(() => {
      const h = window.__seedlandsHarness!;
      h.setSpectatorPosition(0.5, 58.5, 0.5);
      h.setView(0, 0);
      h.setVoxelAt(0, 58, -1, 4);
    });
    await lockPointer(page);
    await page.mouse.down();
    await expect(page.locator('#break-progress')).toBeVisible();
    if (interrupt === 'inventory') await page.keyboard.press('KeyE');
    else if (interrupt === 'pause') await page.keyboard.press('Escape');
    else if (interrupt === 'pointer-lock') await page.evaluate(() => document.exitPointerLock());
    else
      await page.evaluate(() =>
        window.__seedlandsHarness!.executeGameplayCommand({ type: 'apply-damage', amount: 100 }),
      );
    await expect(page.locator('#break-progress')).toBeHidden();
    await page.evaluate(() => window.__seedlandsHarness!.advanceGameplay(5));
    const result = await page.evaluate(() =>
      window.__seedlandsHarness!.executeGameplayCommand({ type: 'inspect-voxel', position: [0, 58, -1] }),
    );
    expect(result).toMatchObject({ success: true, data: { voxel: 4 } });
    await page.mouse.up();
  });
}
