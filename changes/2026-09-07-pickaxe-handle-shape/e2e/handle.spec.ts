import { expect, test } from '@playwright/test';
import { startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

test('石镐直柄在真实手持和掉落物中共用修正网格', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startHarnessWorld(page, 'mosslight-68');
  await waitForSnapshot(page, (s) => s.onGround && !s.colliding && s.generationQueue === 0 && s.meshingQueue === 0);
  await page.evaluate(async () => {
    const h = window.__seedlandsHarness!;
    await h.executeGameplayCommand({ type: 'give-item', itemId: 'stone-pickaxe', count: 1 });
    await h.setWorldTime(10);
    h.setTimePaused(true);
  });
  await page.keyboard.press('KeyE');
  const slot = page.getByRole('gridcell', { name: '石镐 1', exact: true });
  await expect(slot).toBeVisible();
  const index = Number(await slot.getAttribute('data-slot'));
  await page.getByRole('button', { name: '关闭背包', exact: true }).click();
  await page.keyboard.press(`Digit${index + 1}`);
  const meshState = () =>
    page.evaluate(async () => {
      const path = '/changes/2026-09-07-pickaxe-handle-shape/e2e/mesh-probe.ts';
      return ((await import(path)) as typeof import('./mesh-probe')).meshState();
    });
  await expect.poll(meshState).toMatchObject({ count: 1 });
  await page.screenshot({ path: testInfo.outputPath('held-pickaxe.png') });
  await page.evaluate(async () => {
    const h = window.__seedlandsHarness!;
    const p = h.snapshot()!.player;
    await h.fillWorld({
      from: [Math.floor(p[0]) - 1, Math.floor(p[1]) - 1, Math.floor(p[2]) - 5],
      to: [Math.floor(p[0]) + 1, Math.floor(p[1]) + 3, Math.floor(p[2]) + 1],
      voxel: 0,
    });
    await h.fillWorld({
      from: [Math.floor(p[0]) - 1, Math.floor(p[1]) - 2, Math.floor(p[2]) - 5],
      to: [Math.floor(p[0]) + 1, Math.floor(p[1]) - 2, Math.floor(p[2]) + 1],
      voxel: 3,
    });
    h.setView(0, -8);
    const result = await h.executeGameplayCommand({
      type: 'spawn-world-item',
      itemId: 'stone-pickaxe',
      count: 1,
      position: [p[0], p[1] - 0.5, p[2] - 4],
    });
    if (!result.success) throw new Error('Cannot stage pickaxe world item');
  });
  await expect.poll(meshState).toEqual({ count: 2, same: true });
  await page.screenshot({ path: testInfo.outputPath('held-and-world-pickaxe.png') });
  expect(errors).toEqual([]);
});
