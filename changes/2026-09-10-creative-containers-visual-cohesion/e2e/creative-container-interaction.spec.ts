import { expect, test, type Page } from '@playwright/test';
import { lockPointer, moveHarnessPlayer, setHarnessView, startHarnessWorld } from '../../../tests/e2e/support/harness';

const stationCount = (page: Page) =>
  page.evaluate(async () => {
    const result = await window.__seedlandsHarness!.world.checkpoint({ kind: 'export' });
    if (!result.ok || !result.data.snapshot) throw new Error('Checkpoint export failed.');
    const owner = result.data.snapshot.gameplay.entityStore;
    if (owner.version !== 2) throw new Error('Station owner snapshot is unavailable.');
    return owner.stations.length;
  });

async function aimAtStation(page: Page) {
  await lockPointer(page);
  await page.mouse.move(0, 0);
  await setHarnessView(page, 0, -28.81);
  await expect(page.locator('#target-card[data-voxel="12"]')).toBeVisible();
}

test('创造工位使用真实容器，普通右键优先打开，Shift 右键相邻放置，E 保留目录', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startHarnessWorld(page, 'creative-container-interaction', '', 'low');
  await page.evaluate(async () => {
    const harness = window.__seedlandsHarness!;
    const logic = await harness.world.logic({ kind: 'mode', mode: 'scripted' });
    if (!logic.ok) throw new Error('Cannot prepare scripted fixture.');
    await harness.fillWorld({ from: [-2, 59, -2], to: [3, 59, 4], voxel: 3 });
    await harness.fillWorld({ from: [-2, 60, -2], to: [3, 64, 4], voxel: 0 });
    const given = await harness.world.command({ type: 'give-item', itemId: 'plank', count: 3 });
    if (!given.ok || !given.data.success) throw new Error('Cannot prepare survival inventory.');
  });
  await moveHarnessPlayer(page, 0.5, 61.6, 2.5);
  await page.keyboard.press('KeyE');
  await page.getByRole('button', { name: '切换创造模式', exact: true }).click();
  await expect(page.locator('#creative-catalog')).toBeVisible();
  await page.locator('#creative-catalog button[data-item="chest"]').click();
  await page.getByRole('button', { name: '关闭背包', exact: true }).click();

  await lockPointer(page);
  await page.mouse.move(0, 0);
  await setHarnessView(page, 0, -40.36);
  await expect(page.locator('#target-card[data-voxel="3"]')).toBeVisible();
  await page.mouse.click(0, 0, { button: 'right' });
  await expect.poll(() => page.evaluate(() => window.__seedlandsHarness!.getVoxelAt!(0, 60, 0))).toBe(12);
  await expect.poll(() => stationCount(page)).toBe(1);

  await setHarnessView(page, 0, -28.81);
  await expect(page.locator('#target-card[data-voxel="12"]')).toBeVisible();
  expect(await page.evaluate(() => window.__seedlandsHarness!.getVoxelAt!(0, 60, 1))).toBe(0);
  await page.mouse.click(0, 0, { button: 'right' });
  await expect(page.locator('[data-station-kind="chest"]')).toBeVisible();
  await expect(page.locator('#creative-catalog')).toHaveCount(0);
  expect(await page.evaluate(() => window.__seedlandsHarness!.getVoxelAt!(0, 60, 1))).toBe(0);
  expect(await stationCount(page)).toBe(1);

  await page.locator('[data-slot="0"]').click();
  await expect(page.locator('[data-inventory-cursor]')).toHaveAttribute('data-item', 'plank');
  await page.getByRole('button', { name: '关闭背包', exact: true }).click();
  await expect(page.locator('#inventory-crafting')).toBeHidden();
  await page.keyboard.press('KeyE');
  await expect(page.locator('#creative-catalog')).toBeVisible();
  await expect(page.locator('[data-inventory-cursor]')).toHaveCount(0);
  await page.getByRole('button', { name: '关闭背包', exact: true }).click();

  await aimAtStation(page);
  await page.keyboard.down('ShiftLeft');
  await page.mouse.click(0, 0, { button: 'right' });
  await page.keyboard.up('ShiftLeft');
  await expect(page.locator('#inventory-crafting')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__seedlandsHarness!.getVoxelAt!(0, 60, 1))).toBe(12);
  await expect.poll(() => stationCount(page)).toBe(2);

  await setHarnessView(page, 0, -28.81);
  await expect(page.locator('#target-card[data-voxel="12"]')).toBeVisible();
  await page.mouse.click(0, 0, { button: 'right' });
  await expect(page.locator('[data-station-kind="chest"]')).toBeVisible();
  await page.locator('[data-slot="0"]').click();
  await expect(page.locator('[data-inventory-cursor]')).toHaveAttribute('data-item', 'plank');
  await page.getByRole('button', { name: '切换生存模式', exact: true }).click();
  await expect(page.locator('[data-station-kind="chest"]')).toBeVisible();
  await expect(page.locator('[data-inventory-cursor]')).toHaveCount(0);
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-item', 'plank');
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-count', '3');
  expect(errors).toEqual([]);
});
