import { expect, test, type Page } from '@playwright/test';
import { Voxel, normalizeSeed, terrainHeight } from '../../../src/world/voxel';
import type { ServerCommand } from '../../../src/server/commands/command-contract';
import { lockPointer, snapshot, startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

type Point = [number, number, number];
type ReadonlyVoxelHarness = { getVoxelAt?: (x: number, y: number, z: number) => number | null };
type CommandResult = { success: boolean; data?: Record<string, unknown> };

const command = (page: Page, value: ServerCommand) =>
  page.evaluate((input) => window.__seedlandsHarness!.executeGameplayCommand(input) as Promise<CommandResult>, value);

const aim = async (page: Page, target: Point) => {
  const state = (await snapshot(page))!;
  const [dx, dy, dz] = [target[0] - state.player[0], target[1] - state.player[1], target[2] - state.player[2]];
  await page.evaluate(
    ([yaw, pitch]) => window.__seedlandsHarness!.setView(yaw, pitch),
    [(Math.atan2(-dx, -dz) * 180) / Math.PI, (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI],
  );
};

const voxelAt = (page: Page, x: number, y: number, z: number) =>
  page.evaluate(
    ([vx, vy, vz]) => {
      const readOnlyHarness = window.__seedlandsHarness as typeof window.__seedlandsHarness & ReadonlyVoxelHarness;
      if (!readOnlyHarness?.getVoxelAt)
        throw new Error('Natural journey requires the production read-only Harness getVoxelAt(x, y, z).');
      return readOnlyHarness.getVoxelAt(vx, vy, vz);
    },
    [x, y, z],
  );

async function walk(page: Page, x: number, z: number, jump = false, tolerance = 0.4) {
  const state = (await snapshot(page))!;
  await aim(page, [x, state.player[1], z]);
  await page.keyboard.down('KeyW');
  if (jump) await page.keyboard.down('Space');
  try {
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
        .toBeLessThan(tolerance);
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({
        pointerLock: document.pointerLockElement?.id ?? null,
        inventoryOpen: document.querySelector('[role="dialog"][aria-label="背包与合成"]') !== null,
        paused: document.querySelector('.shell-dialog[data-kind="pause"]') !== null,
      }));
      throw new Error(`Natural journey walk failed: ${JSON.stringify({ state: await snapshot(page), diagnostic })}`, {
        cause: error,
      });
    }
  } finally {
    await page.keyboard.up('KeyW');
    if (jump) await page.keyboard.up('Space');
  }
  await waitForSnapshot(page, (state) => state.onGround && !state.colliding);
}

async function mine(page: Page, x: number, y: number, z: number) {
  const before = await voxelAt(page, x, y, z);
  if (before === Voxel.Air) throw new Error(`Natural mining target ${x},${y},${z} was already Air.`);
  await aim(page, [x + 0.5, y + 0.5, z + 0.5]);
  await page.mouse.down();
  try {
    await page.waitForFunction(
      ([vx, vy, vz]) => {
        const readOnlyHarness = window.__seedlandsHarness as typeof window.__seedlandsHarness & ReadonlyVoxelHarness;
        return readOnlyHarness.getVoxelAt?.(vx, vy, vz) === 0;
      },
      [x, y, z],
      { timeout: 8_000, polling: 'raf' },
    );
  } finally {
    await page.mouse.up();
  }
}

const inventory = async (page: Page) => {
  await page.keyboard.press('KeyE');
  const panel = page.getByRole('dialog', { name: '背包与合成' });
  await expect(panel).toBeVisible();
  return panel;
};
const closeInventory = async (page: Page) => {
  await page.getByRole('button', { name: '关闭背包', exact: true }).click();
  await lockPointer(page);
};

test('修复版自然资源到照明、战斗、食用与存退完整旅程', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const seedText = 'living-world-autonomy';
  await startHarnessWorld(page, seedText);
  // Harness 为诊断默认打开 F3；真实玩家旅程明确关闭它并确认实体标签随之隐藏。
  await expect(page.locator('#presented-entity-semantics [role="img"]')).not.toHaveCount(0);
  await page.keyboard.press('F3');
  await expect(page.locator('#presented-entity-semantics [role="img"]')).toHaveCount(0);

  const origin = (await waitForSnapshot(page, (state) => state.onGround && !state.colliding)).player;
  const seed = normalizeSeed(seedText);
  const treeX = Math.floor(origin[0]) + 6;
  const treeZ = Math.floor(origin[2]) - 4;
  const treeY = terrainHeight(seed, treeX, treeZ) + 1;
  await lockPointer(page);
  await walk(page, treeX - 1.5, treeZ + 0.5);
  for (let dy = 0; dy < 3; dy += 1) await mine(page, treeX, treeY + dy, treeZ);
  await walk(page, treeX + 0.5, treeZ + 0.5);

  let panel = await inventory(page);
  await expect(panel.getByRole('gridcell', { name: '原木 3', exact: true })).toBeVisible();
  for (const recipe of ['合成 木板', '合成 木板', '合成 木斧'])
    await panel.getByRole('button', { name: recipe, exact: true }).click();
  await panel.getByRole('gridcell', { name: '木斧 1', exact: true }).click();
  await panel.getByRole('button', { name: '装备到当前快捷栏' }).click();
  await closeInventory(page);

  const quarryX = Math.floor(origin[0]) + 20;
  const quarryZ = Math.floor(origin[2]) - 12;
  // 离开树干后绕至开阔地；直冲采石场会把 W 输入压在树根上。
  await walk(page, treeX + 6.5, treeZ + 5.5, true);
  await walk(page, quarryX + 0.5, treeZ + 5.5, true);
  await walk(page, quarryX - 0.5, quarryZ + 0.5, true);
  for (let step = 0; step < 5; step += 1) {
    const x = quarryX + step;
    const top = terrainHeight(seed, x, quarryZ);
    for (let depth = 0; depth <= step; depth += 1) {
      const y = top - depth;
      if ((await voxelAt(page, x, y, quarryZ)) !== Voxel.Air) await mine(page, x, y, quarryZ);
    }
    await walk(page, quarryX + step + 0.5, quarryZ + 0.5);
  }
  for (let dx = 5; dx < 8; dx += 1) {
    const x = quarryX + dx;
    const top = terrainHeight(seed, x, quarryZ);
    for (let depth = 0; depth <= 4; depth += 1) {
      const y = top - depth;
      if ((await voxelAt(page, x, y, quarryZ)) !== Voxel.Air) await mine(page, x, y, quarryZ);
    }
    await walk(page, x + 0.5, quarryZ + 0.5);
  }
  panel = await inventory(page);
  await expect(panel.getByRole('gridcell', { name: '石块 4', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '合成 石镐', exact: true }).click();
  await panel.getByRole('button', { name: '合成 灯笼', exact: true }).click();
  await closeInventory(page);

  // 用旅程中自然取得的原木建基座，再放置刚制作的灯笼；不以 debug 编辑跳过建造。
  const buildX = quarryX - 3;
  const buildZ = quarryZ + 3;
  const buildY = terrainHeight(seed, buildX, buildZ);
  await walk(page, buildX + 2.5, buildZ + 2.5, true);
  panel = await inventory(page);
  await panel.getByRole('gridcell', { name: '原木 1', exact: true }).click();
  await panel.getByRole('button', { name: '装备到当前快捷栏' }).click();
  await closeInventory(page);
  await aim(page, [buildX + 0.5, buildY + 0.999, buildZ + 0.5]);
  await expect(voxelAt(page, buildX, buildY + 1, buildZ)).resolves.toBe(Voxel.Air);
  await page.mouse.click(640, 360, { button: 'right' });
  await expect.poll(() => voxelAt(page, buildX, buildY + 1, buildZ)).toBe(Voxel.Wood);
  panel = await inventory(page);
  await panel.getByRole('gridcell', { name: '灯笼 1', exact: true }).click();
  await panel.getByRole('button', { name: '装备到当前快捷栏' }).click();
  await closeInventory(page);
  await aim(page, [buildX + 0.5, buildY + 1.99, buildZ + 0.5]);
  await expect(voxelAt(page, buildX, buildY + 2, buildZ)).resolves.toBe(Voxel.Air);
  await page.mouse.click(640, 360, { button: 'right' });
  await expect.poll(() => voxelAt(page, buildX, buildY + 2, buildZ)).toBe(Voxel.Lantern);
  await expect.poll(() => snapshot(page).then((state) => state!.visualEffects.activeLocalLights)).toBe(1);
  panel = await inventory(page);
  await panel.getByRole('gridcell', { name: /沙块 [1-9][0-9]*/ }).click();
  await panel.getByRole('button', { name: '装备到当前快捷栏' }).click();
  await closeInventory(page);
  for (const [x, z] of [
    [buildX, buildZ - 1],
    [buildX - 1, buildZ - 1],
    [buildX - 1, buildZ],
  ]) {
    const y = terrainHeight(seed, x, z);
    await walk(page, x - 1.5, z + 1.5, true, 0.9);
    await aim(page, [x + 0.5, y + 0.999, z + 0.5]);
    await expect(page.locator('#target-card')).toHaveAttribute('data-target', `${x},${y},${z}`);
    await expect(voxelAt(page, x, y + 1, z)).resolves.toBe(Voxel.Air);
    await page.mouse.click(640, 360, { button: 'right' });
    await expect.poll(() => voxelAt(page, x, y + 1, z)).toBe(Voxel.Sand);
  }

  const hostile = page.getByRole('img', { name: '夜行兽', exact: true });
  await page.keyboard.press('F3');
  await expect(hostile).not.toHaveCount(0);
  const initialHostilePosition = (await hostile.getAttribute('data-position'))!.split(',').map(Number);
  const hostileId = (await hostile.getAttribute('data-entity-id'))!;
  const initialHostile = (await command(page, { type: 'query-entity', entityId: hostileId })).data?.entity as {
    health: number;
  };
  expect(initialHostile.health).toBeGreaterThan(0);
  await walk(page, initialHostilePosition[0] + 2, initialHostilePosition[2]);
  let observedDamage = false;
  for (let hit = 0; hit < 4; hit += 1) {
    const before = (await command(page, { type: 'query-entity', entityId: hostileId })).data?.entity as {
      health: number;
    } | null;
    if (!before) break;
    await expect
      .poll(
        async () => {
          const target = (await hostile.getAttribute('data-position'))!.split(',').map(Number);
          await aim(page, [target[0], target[1] + 0.9, target[2]]);
          await page.mouse.click(640, 360);
          const current = (await command(page, { type: 'query-entity', entityId: hostileId })).data?.entity as {
            health: number;
          } | null;
          return current?.health ?? 0;
        },
        { timeout: 3_000, intervals: [100, 200, 300] },
      )
      .toBeLessThan(before.health);
    observedDamage = true;
  }
  expect(observedDamage).toBe(true);
  expect((await command(page, { type: 'query-entity', entityId: hostileId })).data?.entity).toBeNull();
  await expect(hostile).toHaveCount(0);
  await page.keyboard.press('F3');

  await expect
    .poll(async () => Number(await page.getByRole('meter', { name: '饥饿' }).getAttribute('aria-valuenow')), {
      timeout: 150_000,
    })
    .toBeLessThan(20);
  panel = await inventory(page);
  const hunger = Number(await page.getByRole('meter', { name: '饥饿' }).getAttribute('aria-valuenow'));
  await panel.getByRole('gridcell', { name: /浆果 [1-9][0-9]*/ }).click();
  await panel.getByRole('button', { name: '食用浆果', exact: true }).click();
  await expect
    .poll(async () => Number(await page.getByRole('meter', { name: '饥饿' }).getAttribute('aria-valuenow')))
    .toBeGreaterThan(hunger);
  const savedHunger = Number(await page.getByRole('meter', { name: '饥饿' }).getAttribute('aria-valuenow'));
  const savedSlots = await panel.getByRole('gridcell').allTextContents();
  await page.getByRole('button', { name: '关闭背包', exact: true }).click();
  await page.getByRole('button', { name: '暂停游戏', exact: true }).click();
  await page.getByRole('button', { name: '保存并返回主菜单' }).click();
  await page.getByRole('button', { name: '继续世界', exact: true }).click();
  await waitForSnapshot(page, (state) => state.onGround && !state.colliding);
  await page.keyboard.press('F3');
  await expect(page.locator(`[data-entity-id="${hostileId}"]`)).toHaveCount(0);
  expect((await command(page, { type: 'query-entity', entityId: hostileId })).data?.entity).toBeNull();
  await page.keyboard.press('F3');
  await expect(voxelAt(page, buildX, buildY + 1, buildZ)).resolves.toBe(Voxel.Wood);
  await expect(voxelAt(page, buildX, buildY + 2, buildZ)).resolves.toBe(Voxel.Lantern);
  for (const [x, z] of [
    [buildX, buildZ - 1],
    [buildX - 1, buildZ - 1],
    [buildX - 1, buildZ],
  ])
    await expect(voxelAt(page, x, terrainHeight(seed, x, z) + 1, z)).resolves.toBe(Voxel.Sand);
  panel = await inventory(page);
  expect(await panel.getByRole('gridcell').allTextContents()).toEqual(savedSlots);
  await expect(page.getByRole('meter', { name: '饥饿' })).toHaveAttribute('aria-valuenow', String(savedHunger));
  await closeInventory(page);
  await walk(page, buildX + 2.5, buildZ + 2.5, true);
  await expect.poll(() => snapshot(page).then((state) => state!.visualEffects.activeLocalLights)).toBe(1);
  await testInfo.attach('repair-natural-save-continue', { body: await page.screenshot(), contentType: 'image/png' });
  expect(errors).toEqual([]);
});

test('自然旅程使用生产只读体素观察入口', async ({ page }) => {
  await startHarnessWorld(page, 'living-world-autonomy');
  await expect(voxelAt(page, 0, 0, 0)).resolves.not.toBeNull();
});
