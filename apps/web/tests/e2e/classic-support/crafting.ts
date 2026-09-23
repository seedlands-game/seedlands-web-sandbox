import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
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
import { itemCount } from './journey';

async function placePersonalIngredients(panel: Locator, name: string, slots: readonly number[]): Promise<void> {
  const source = panel.getByRole('gridcell', { name: new RegExp(`^${name} × [0-9]+(?: ·.*)?$`) }).first();
  await expect(source).toBeVisible();
  const sourceSlot = Number(await source.getAttribute('data-slot'));
  const sourceCount = Number(await source.getAttribute('data-count'));
  if (!Number.isSafeInteger(sourceSlot) || !Number.isSafeInteger(sourceCount) || sourceCount < slots.length)
    throw new Error(`Insufficient ${name} for personal crafting.`);
  await source.click();
  for (const slot of slots)
    await panel.locator(`[data-inventory-address="crafting:${slot}"]`).click({ button: 'right' });
  if (sourceCount > slots.length) await panel.locator(`[data-slot="${sourceSlot}"]`).click();
}

async function takePersonalResult(panel: Locator, itemId: string): Promise<void> {
  const result = panel.locator('[data-personal-craft-result]');
  await expect(result).toHaveAttribute('data-item', itemId);
  await result.click({ modifiers: ['Shift'] });
  await expect(result).toHaveAttribute('data-item', 'empty');
}

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
  await expect(panel.locator('[data-crafting-slot]')).toHaveCount(4);
  await panel.getByText('配方手册', { exact: false }).click();
  await expect(panel.locator('[data-recipe="planks"]')).toBeAttached();
  await expect(panel.locator('[data-recipe="wood-pickaxe"]')).toHaveCount(0);
  await panel.getByText('配方手册', { exact: false }).click();
  expect(
    await panel.locator('[data-inventory-address]').evaluateAll((slots) =>
      slots.flatMap((slot) => {
        const image = slot.querySelector<HTMLImageElement>('.item-icon');
        if (!image) return [];
        const outer = slot.getBoundingClientRect();
        const inner = image.getBoundingClientRect();
        return inner.left >= outer.left &&
          inner.top >= outer.top &&
          inner.right <= outer.right &&
          inner.bottom <= outer.bottom
          ? []
          : [slot.getAttribute('data-inventory-address')];
      }),
    ),
  ).toEqual([]);

  const logs = panel.getByRole('gridcell', { name: '原木 × 4', exact: true });
  await logs.click();
  await panel.locator('[data-inventory-address="crafting:0"]').click();
  await takePersonalResult(panel, 'plank');
  await expect.poll(async () => itemCount(await playerState(page), 'plank')).toBe(16);

  await placePersonalIngredients(panel, '木板', [0, 1]);
  await takePersonalResult(panel, 'stick');
  await placePersonalIngredients(panel, '木板', [0, 1]);
  await placePersonalIngredients(panel, '木棍', [2]);
  await takePersonalResult(panel, 'wood-sword');
  await placePersonalIngredients(panel, '木板', [0, 1, 2, 3]);
  await takePersonalResult(panel, 'workbench');

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

export async function replaceGlassWithDiamondBlock(page: Page, testInfo: TestInfo): Promise<void> {
  const glass: Point = [
    classicScenario.route.stationTarget[0] - 1,
    classicScenario.route.stationTarget[1],
    classicScenario.route.stationTarget[2],
  ];
  await aimAtVoxelWithRealMouse(page, glass);
  await clickCanvasCenter(page, 'left');
  await expect.poll(() => voxelAt(page, glass)).toBe(0);
  await page.keyboard.press('KeyE');
  const catalog = page.getByRole('dialog', { name: '创造内容目录' });
  await expect(catalog).toBeVisible();
  for (const name of ['金矿石', '钻石矿石', '铁块', '金块', '钻石块', '金锭', '钻石', '金镐', '钻石镐']) {
    const button = catalog.getByRole('button', { name: new RegExp('^将' + name + '放入创造快捷栏 ') });
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeVisible();
    await expect
      .poll(() => button.locator('img').evaluate((node) => (node as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
  }
  await catalog.getByRole('button', { name: /^将钻石块放入创造快捷栏 / }).click();
  await closeInventory(page);
  await aimAtVoxelWithRealMouse(page, classicScenario.route.stationTarget);
  const before = (await snapshot(page))!;
  await page.keyboard.down('ShiftLeft');
  try {
    await clickCanvasCenter(page, 'right');
  } finally {
    await page.keyboard.up('ShiftLeft');
  }
  await expect.poll(() => voxelAt(page, glass)).toBe(23);
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
  await testInfo.attach('diamond-block-after-restore', { body: await page.screenshot(), contentType: 'image/png' });
}
