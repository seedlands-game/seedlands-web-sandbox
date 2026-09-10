import { expect, test, type Page } from '@playwright/test';
import {
  startHarnessWorld,
  lockPointer,
  moveHarnessPlayer,
  setHarnessView,
  snapshot,
} from '../../../tests/e2e/support/harness';

async function lock(page: Page) {
  if (!(await page.evaluate(() => document.pointerLockElement?.id === 'game'))) await lockPointer(page);
  await page.mouse.move(0, 0);
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}
const bag = (page: Page) => page.getByRole('grid', { name: '背包槽位', exact: true });
const item = (page: Page, id: string) => bag(page).locator(`[data-item="${id}"]`);
async function inventory(page: Page) {
  await page.keyboard.press('KeyE');
  await expect(page.getByRole('dialog', { name: '背包与合成' })).toBeVisible();
}
async function close(page: Page) {
  await page.getByRole('button', { name: '关闭背包', exact: true }).click();
  await lock(page);
}
async function aim(page: Page, x: number, y: number, z: number) {
  const current = (await snapshot(page))!;
  const dx = x - current.player[0],
    dy = y - current.player[1],
    dz = z - current.player[2];
  await setHarnessView(
    page,
    (Math.atan2(-dx, -dz) * 180) / Math.PI,
    (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI,
  );
}
async function equip(page: Page, id: string) {
  await inventory(page);
  await item(page, id).click();
  const button = page.getByRole('button', { name: '装备到当前快捷栏' });
  if (await button.isEnabled()) await button.click();
  await close(page);
}
async function openStation(page: Page, kind: string, x: number, z: number) {
  await moveHarnessPlayer(page, x + 0.5, 61.6, z + 2.5);
  await lock(page);
  await aim(page, x + 0.5, 60.5, z + 0.5);
  await expect(page.locator('#target-card')).toBeVisible();
  await page.mouse.click(0, 0, { button: 'right' });
  await expect(page.locator(`[data-station-kind="${kind}"]`)).toBeVisible();
}
async function put(page: Page, id: string, index: number, count = 1) {
  for (let attempt = 0; attempt < count; attempt++) {
    await item(page, id).first().click();
    const target = page.locator(`[data-station-slot="${index}"]`);
    const countLabel = target.locator('strong');
    const previous = (await countLabel.count()) ? Number(await countLabel.textContent()) : 0;
    await target.click();
    if (id === 'coal') await expect(page.locator('.station-panel')).toContainText(/剩余燃烧时间 [1-9]/);
    else await expect(target.locator('strong')).toHaveText(String(previous + 1));
  }
}
async function craftStation(page: Page, id: string, name: string, material: string, ring = false) {
  const pattern = ring ? [0, 1, 2, 3, 5, 6, 7, 8] : [0, 1, 2];
  for (const index of pattern) await put(page, material, index);
  if (!ring) {
    await put(page, 'plank', 4);
    await put(page, 'plank', 7);
  }
  await page.getByRole('button', { name: `工作台合成${name} × 1`, exact: true }).click();
  await expect(item(page, id)).toBeVisible();
}
async function place(page: Page, itemId: string, voxel: number, x: number, z: number) {
  await equip(page, itemId);
  await moveHarnessPlayer(page, x + 0.5, 61.6, z + 2.5);
  await aim(page, x + 0.5, 59.9, z + 0.5);
  await expect(page.locator('#target-card[data-voxel="3"]')).toBeVisible();
  await page.mouse.click(0, 0, { button: 'right' });
  await expect
    .poll(() => page.evaluate(([x, z]) => window.__seedlandsHarness!.getVoxelAt!(x, 60, z), [x, z]))
    .toBe(voxel);
}
async function mine(page: Page, x: number, voxel: number) {
  await moveHarnessPlayer(page, x + 0.5, 61.6, 2.5);
  await lock(page);
  await aim(page, x + 0.5, 60.5, 0.5);
  await expect(page.locator(`#target-card[data-voxel="${voxel}"]`)).toBeVisible();
  await page.mouse.down();
  try {
    await expect
      .poll(() => page.evaluate((x) => window.__seedlandsHarness!.getVoxelAt!(x, 60, 0), x), { timeout: 6000 })
      .toBe(0);
  } finally {
    await page.mouse.up();
  }
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(470);
  await page.keyboard.up('KeyW');
}

const browserQuality = process.env.SEEDLANDS_BROWSER_E2E_QUALITY ?? 'medium';
if (browserQuality !== 'low' && browserQuality !== 'medium' && browserQuality !== 'high')
  throw new Error('Unknown browser E2E quality.');

test('正常鼠标和槽位操作完成木石铁成长、箱子与保存重进', async ({ page }, info) => {
  test.setTimeout(480_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startHarnessWorld(page, 'browser-overworld-progression', '', browserQuality);
  expect((await snapshot(page))?.quality).toBe(browserQuality);
  // 有限原料与固定可采区域；后续不调用 give/craft/place/break 等开发者操作。
  await page.evaluate(async () => {
    const h = window.__seedlandsHarness!;
    await h.world.logic({ kind: 'mode', mode: 'scripted' });
    await h.fillWorld({ from: [-26, 59, -2], to: [5, 59, 4], voxel: 3 });
    await h.fillWorld({ from: [-26, 60, -2], to: [5, 64, 4], voxel: 0 });
    for (let x = -2; x >= -9; x--) await h.setVoxelAt(x, 60, 0, 4);
    for (let x = -10; x >= -20; x--) await h.setVoxelAt(x, 60, 0, 3);
    await h.setVoxelAt(-21, 60, 0, 14);
    for (let x = -22; x >= -24; x--) await h.setVoxelAt(x, 60, 0, 15);
  });
  for (let x = -2; x >= -9; x--) await mine(page, x, 4);
  await inventory(page);
  for (let i = 0; i < 8; i++) await page.getByRole('button', { name: '合成 木板', exact: true }).click();
  await page.getByRole('button', { name: '合成 工作台', exact: true }).click();
  await expect(item(page, 'workbench')).toBeVisible();
  await close(page);
  await place(page, 'workbench', 11, 2, 0);
  await openStation(page, 'workbench', 2, 0);
  await craftStation(page, 'wood-pickaxe', '木镐', 'plank');
  await expect
    .poll(() =>
      page
        .locator('.inventory-dialog img')
        .evaluateAll((images) =>
          images.every((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0),
        ),
    )
    .toBe(true);
  await page.locator('.inventory-dialog').evaluate((dialog) => dialog.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath('workbench-wood-pickaxe.png') });
  await close(page);
  await equip(page, 'wood-pickaxe');
  for (let x = -10; x >= -12; x--) await mine(page, x, 3);
  await openStation(page, 'workbench', 2, 0);
  await craftStation(page, 'stone-pickaxe', '石镐', 'stone-block');
  await expect(item(page, 'wood-pickaxe')).toContainText('57/60');
  await close(page);
  await equip(page, 'stone-pickaxe');
  for (let x = -13; x >= -20; x--) await mine(page, x, 3);
  await mine(page, -21, 14);
  for (let x = -22; x >= -24; x--) await mine(page, x, 15);
  await openStation(page, 'workbench', 2, 0);
  await craftStation(page, 'furnace', '炉体', 'stone-block', true);
  await craftStation(page, 'chest', '箱子', 'plank', true);
  await close(page);
  await place(page, 'furnace', 13, 4, 0);
  await place(page, 'chest', 12, 0, 0);
  await openStation(page, 'furnace', 4, 0);
  await put(page, 'raw-iron', 0, 3);
  await put(page, 'coal', 1);
  await expect(page.locator('[data-station-slot="2"] strong')).toHaveText('3', { timeout: 22000 });
  await page.screenshot({ path: info.outputPath('furnace-iron-output.png') });
  await page.getByLabel('每次移动整组（默认一个）').check();
  await page.locator('[data-station-slot="2"]').click();
  await bag(page).locator('[data-item="empty"]').first().click();
  await expect(item(page, 'iron-ingot')).toContainText('3');
  await close(page);
  await openStation(page, 'workbench', 2, 0);
  await craftStation(page, 'iron-pickaxe', '铁镐', 'iron-ingot');
  await expect(item(page, 'iron-pickaxe')).toContainText('250/250');
  await page.locator('.inventory-dialog').evaluate((dialog) => dialog.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath('iron-pickaxe-complete.png') });
  await close(page);
  await openStation(page, 'chest', 0, 0);
  await put(page, 'wood-pickaxe', 0);
  await page.evaluate(() => window.__seedlandsHarness!.flushSave());
  await startHarnessWorld(page, 'browser-overworld-progression', '', browserQuality);
  expect((await snapshot(page))?.quality).toBe(browserQuality);
  await inventory(page);
  await expect(item(page, 'iron-pickaxe')).toContainText('250/250');
  await close(page);
  await openStation(page, 'chest', 0, 0);
  await expect(page.locator('[data-station-slot="0"]')).toContainText('木镐');
  expect(errors).toEqual([]);
});
