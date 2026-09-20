import { expect, type Page, type TestInfo } from '@playwright/test';
import {
  inventory,
  closeInventory,
  playerState,
  walkTo,
  clickCanvasCenter,
  voxelAt,
  snapshot,
  waitForSnapshot,
} from './harness';
import { aimAtVoxelWithRealMouse } from './aim';
import { classicScenario, type Point } from './scenario';

export async function craftAndEquipBuildingPlanks(page: Page): Promise<void> {
  const rows = await page
    .locator('#hotbar li')
    .evaluateAll((slots) => slots.map((slot) => slot.getBoundingClientRect().y));
  expect(rows).toHaveLength(9);
  expect(Math.max(...rows) - Math.min(...rows)).toBeLessThan(1);
  const panel = await inventory(page);
  await expect(panel.locator('[data-inventory-address^="inventory:"]')).toHaveCount(36);
  await expect(panel.locator('[data-slot="35"]')).toBeVisible();
  expect((await playerState(page)).hotbarSize).toBe(9);
  await expect(panel.getByRole('gridcell', { name: '原木 × 4', exact: true })).toBeVisible();
  await expect(panel.getByRole('gridcell', { name: '浆果 × 1', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '合成 木板', exact: true }).click();
  await panel.getByRole('button', { name: '合成 木板', exact: true }).click();
  await panel.getByRole('button', { name: '合成 木板', exact: true }).click();
  await panel.getByRole('button', { name: '合成 木棍', exact: true }).click();
  await panel.getByRole('button', { name: '合成 木斧', exact: true }).click();
  await panel.getByRole('button', { name: '合成 木剑', exact: true }).click();
  await panel.getByRole('button', { name: '合成 工作台', exact: true }).click();
  await expect(panel.getByRole('gridcell', { name: /^木斧 × 1 · 耐久 60\/60$/ })).toBeVisible();
  await expect(panel.getByRole('gridcell', { name: '木剑 × 1', exact: true })).toBeVisible();
  await expect(panel.getByRole('gridcell', { name: '工作台 × 1', exact: true })).toBeVisible();
  const planks = panel.getByRole('gridcell', { name: /^木板 × / }).first();
  await planks.hover();
  await page.keyboard.press('Digit9');
  await expect(panel.locator('[data-slot="8"]')).toHaveAttribute('data-item', 'plank');
  await closeInventory(page);
  await page.keyboard.press('Digit9');
  await expect.poll(async () => (await playerState(page)).selectedSlot).toBe(8);
}

export async function placeGlassAfterRestore(page: Page, testInfo: TestInfo): Promise<void> {
  await walkTo(page, classicScenario.route.stationApproach, { key: 'KeyS' });
  const panel = await inventory(page);
  await panel.getByRole('button', { name: '切换创造模式', exact: true }).click();
  const catalog = page.getByRole('dialog', { name: '创造内容目录' });
  await catalog.getByRole('button', { name: /^将玻璃放入创造快捷栏 / }).click();
  await closeInventory(page);
  const target: Point = [
    classicScenario.route.stationTarget[0] - 1,
    classicScenario.route.stationTarget[1],
    classicScenario.route.stationTarget[2],
  ];
  await aimAtVoxelWithRealMouse(page, classicScenario.route.stationTarget);
  const before = (await snapshot(page))!;
  await page.keyboard.down('ShiftLeft');
  try {
    await clickCanvasCenter(page, 'right');
  } finally {
    await page.keyboard.up('ShiftLeft');
  }
  await expect.poll(() => voxelAt(page, target)).toBe(18);
  await waitForSnapshot(
    page,
    (value) =>
      value.worldRevision > before.worldRevision &&
      value.remeshSchedulingCount > before.remeshSchedulingCount &&
      value.lastCommitMeshChunkCount > 0,
  );
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  await testInfo.attach('glass-built-after-restore', { body: await page.screenshot(), contentType: 'image/png' });
}
