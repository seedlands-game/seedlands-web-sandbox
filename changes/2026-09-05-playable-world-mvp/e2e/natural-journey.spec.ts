import { expect, test, type Page } from '@playwright/test';
import { terrainHeight, normalizeSeed } from '../../../src/world/voxel';
import { lockPointer, snapshot, startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

type Point = [number, number, number];
async function aim(page: Page, target: Point) {
  const state = (await snapshot(page))!;
  const dx = target[0] - state.player[0],
    dy = target[1] - state.player[1],
    dz = target[2] - state.player[2];
  await page.evaluate(
    ([yaw, pitch]) => window.__seedlandsHarness!.setView(yaw, pitch),
    [(Math.atan2(-dx, -dz) * 180) / Math.PI, (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI],
  );
}
async function walk(page: Page, x: number, z: number, jump = false) {
  const state = (await snapshot(page))!;
  await aim(page, [x, state.player[1], z]);
  await page.keyboard.down('KeyW');
  if (jump) await page.keyboard.down('Space');
  try {
    await expect
      .poll(
        async () => {
          const current = (await snapshot(page))!;
          const distance = Math.hypot(current.player[0] - x, current.player[2] - z);
          if (distance >= 0.4) await aim(page, [x, current.player[1], z]);
          return distance;
        },
        { timeout: 15_000, intervals: [100] },
      )
      .toBeLessThan(0.4);
  } finally {
    await page.keyboard.up('KeyW');
    if (jump) await page.keyboard.up('Space');
  }
  await waitForSnapshot(page, (s) => s.onGround && !s.colliding);
}
async function mine(page: Page, x: number, y: number, z: number) {
  await aim(page, [x + 0.5, y + 0.5, z + 0.5]);
  const before = (await snapshot(page))!.worldRevision;
  await page.mouse.down();
  try {
    await expect.poll(async () => (await snapshot(page))!.worldRevision, { timeout: 6000 }).toBeGreaterThan(before);
  } finally {
    await page.mouse.up();
  }
}
async function inventory(page: Page) {
  await page.keyboard.press('KeyE');
  const panel = page.getByRole('dialog', { name: '背包与合成' });
  await expect(panel).toBeVisible();
  return panel;
}
async function closeInventory(page: Page) {
  await page.getByRole('button', { name: '关闭背包', exact: true }).click();
  await lockPointer(page);
}

test('自然资源到工具、采石、建造照明、危险与存档的完整旅程', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const seedText = 'living-world-autonomy';
  await startHarnessWorld(page, seedText);
  const origin = (await waitForSnapshot(page, (s) => s.onGround && !s.colliding)).player;
  const seed = normalizeSeed(seedText);
  const treeX = Math.floor(origin[0]) + 6,
    treeZ = Math.floor(origin[2]) - 4;
  const treeY = terrainHeight(seed, treeX, treeZ) + 1;
  await lockPointer(page);
  await walk(page, treeX - 1.5, treeZ + 0.5);
  for (let dy = 0; dy < 3; dy++) await mine(page, treeX, treeY + dy, treeZ);
  // 上层原木被侧面树叶遮挡，先前一次真实采集清掉遮挡，再取木材。
  await mine(page, treeX, treeY + 2, treeZ);
  await walk(page, treeX + 0.5, treeZ + 0.5);
  let panel = await inventory(page);
  await expect(panel.getByRole('gridcell', { name: '原木 3', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '合成 木板', exact: true }).click();
  await panel.getByRole('button', { name: '合成 木板', exact: true }).click();
  await panel.getByRole('button', { name: '合成 木斧', exact: true }).click();
  await panel.getByRole('gridcell', { name: '木斧 1', exact: true }).click();
  await panel.getByRole('button', { name: '装备到当前快捷栏' }).click();
  await closeInventory(page);
  await walk(page, treeX - 0.5, treeZ + 0.5);
  panel = await inventory(page);
  await expect(panel.getByRole('gridcell', { name: /浆果 [1-9][0-9]*/ })).toBeVisible();
  await testInfo.attach('natural-tools', { body: await page.screenshot(), contentType: 'image/png' });
  await closeInventory(page);

  const qx = Math.floor(origin[0]) + 20,
    qz = Math.floor(origin[2]) - 12;
  const surface = terrainHeight(seed, qx, qz);
  await walk(page, qx + 0.5, qz + 0.5);
  for (let step = 0; step < 5; step++) {
    for (let y = surface; y >= surface - step; y--) await mine(page, qx + step, y, qz);
    await walk(page, qx + step + 0.5, qz + 0.5);
  }
  for (let dx = 5; dx < 8; dx++) {
    await mine(page, qx + dx, surface - 3, qz);
    await mine(page, qx + dx, surface - 4, qz);
    await walk(page, qx + dx + 0.5, qz + 0.5);
  }
  panel = await inventory(page);
  await expect(panel.getByRole('gridcell', { name: '石块 4', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '合成 石镐', exact: true }).click();
  await panel.getByRole('button', { name: '合成 灯笼', exact: true }).click();
  await testInfo.attach('natural-quarry-crafting', { body: await page.screenshot(), contentType: 'image/png' });
  await closeInventory(page);
  await walk(page, qx + 4.5, qz + 0.5);
  for (let step = 3; step >= 0; step--) await walk(page, qx + step + 0.5, qz + 0.5, true);
  await walk(page, qx - 0.5, qz + 0.5, true);
  await walk(page, qx - 1.5, qz + 0.5);

  panel = await inventory(page);
  await panel.getByRole('gridcell', { name: '原木 1', exact: true }).click();
  await panel.getByRole('button', { name: '装备到当前快捷栏' }).click();
  await closeInventory(page);
  const bx = qx - 3,
    bz = qz + 3,
    by = terrainHeight(seed, bx, bz);
  await aim(page, [bx + 0.5, by + 0.999, bz + 0.5]);
  let revision = (await snapshot(page))!.worldRevision;
  await page.mouse.click(640, 360, { button: 'right' });
  await expect.poll(async () => (await snapshot(page))!.worldRevision).toBeGreaterThan(revision);
  panel = await inventory(page);
  await panel.getByRole('gridcell', { name: '灯笼 1', exact: true }).click();
  await panel.getByRole('button', { name: '装备到当前快捷栏' }).click();
  await closeInventory(page);
  await aim(page, [bx + 0.5, by + 1.99, bz + 0.5]);
  await page.mouse.click(640, 360, { button: 'right' });
  await expect.poll(async () => (await snapshot(page))!.visualEffects.activeLocalLights).toBe(1);
  panel = await inventory(page);
  await panel.getByRole('gridcell', { name: /沙块 [1-9][0-9]*/ }).click();
  await panel.getByRole('button', { name: '装备到当前快捷栏' }).click();
  await closeInventory(page);
  for (const [x, z] of [
    [bx - 1, bz],
    [bx - 1, bz - 1],
    [bx, bz - 1],
  ]) {
    await aim(page, [x + 0.5, terrainHeight(seed, x, z) + 0.999, z + 0.5]);
    revision = (await snapshot(page))!.worldRevision;
    await page.mouse.click(640, 360, { button: 'right' });
    await expect.poll(async () => (await snapshot(page))!.worldRevision).toBeGreaterThan(revision);
  }
  await testInfo.attach('natural-built-lantern', { body: await page.screenshot(), contentType: 'image/png' });

  const hostile = page.getByRole('img', { name: '夜行兽', exact: true });
  const enemy = (await hostile.getAttribute('data-position'))!.split(',').map(Number);
  await walk(page, enemy[0] + 2, enemy[2]);
  for (let hit = 0; hit < 8 && (await hostile.count()); hit++) {
    const target = (await hostile.getAttribute('data-position'))!.split(',').map(Number);
    await aim(page, [target[0], target[1] + 0.9, target[2]]);
    await page.mouse.click(640, 360);
    await page.waitForTimeout(550); // 真实攻击节奏，终态由实体消失断言。
  }
  await expect(hostile).toHaveCount(0);
  await expect(page.getByRole('button', { name: '复活', exact: true })).toBeHidden();
  await expect
    .poll(async () => Number(await page.getByRole('meter', { name: '饥饿' }).getAttribute('aria-valuenow')), {
      timeout: 150000,
    })
    .toBeLessThan(20);
  panel = await inventory(page);
  const hunger = Number(await page.getByRole('meter', { name: '饥饿' }).getAttribute('aria-valuenow'));
  await panel.getByRole('gridcell', { name: /浆果 [1-9][0-9]*/ }).click();
  await panel.getByRole('button', { name: '食用浆果', exact: true }).click();
  await expect
    .poll(async () => Number(await page.getByRole('meter', { name: '饥饿' }).getAttribute('aria-valuenow')))
    .toBeGreaterThan(hunger);
  const savedSlots = await panel.getByRole('gridcell').allTextContents();
  await page.getByRole('button', { name: '关闭背包', exact: true }).click();
  await page.getByRole('button', { name: '暂停游戏', exact: true }).click();
  await page.getByRole('button', { name: '保存并返回主菜单' }).click();
  await page.getByRole('button', { name: '继续世界', exact: true }).click();
  await waitForSnapshot(page, (s) => s.onGround && !s.colliding);
  await expect(hostile).toHaveCount(0);
  panel = await inventory(page);
  expect(await panel.getByRole('gridcell').allTextContents()).toEqual(savedSlots);
  await testInfo.attach('natural-save-continue', { body: await page.screenshot(), contentType: 'image/png' });
  expect(errors).toEqual([]);
});
