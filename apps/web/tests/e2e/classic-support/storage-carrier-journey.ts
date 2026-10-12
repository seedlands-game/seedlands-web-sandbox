import { expect, type Page } from '@playwright/test';
import { startClassicWorld, confirmClassicPerformanceWarning } from './start';
import { classicScenario } from './scenario';
import { snapshot, playerState, lockPointer, clickCanvasCenter, moveMouseBy, type ClassicWindow } from './harness';
import { aimAtVoxelWithRealMouse } from './aim';
import { mouseCorrectionToPoint } from './target-aim';
import { browserArtifact, browserPackLock, compositionIdentity } from './identity';
import { modularPackSmokeEnabled } from './modular-pack-smoke';
import { collectClassicFailureDiagnostics } from './evidence';

const carriers = (page: Page) =>
  page.evaluate(() => (window as unknown as ClassicWindow).__seedlandsHarness!.transportSnapshot());
async function aimCarrier(page: Page, position: readonly number[]) {
  for (let attempt = 0; attempt < 18; attempt++) {
    const state = await snapshot(page);
    if (!state) throw Error('Accepted player snapshot missing');
    const correction = mouseCorrectionToPoint(state.player, state.viewAngles, [
      position[0],
      position[1] + 0.35,
      position[2],
    ]);
    if (Math.abs(correction.dx) * 0.13 < 0.5 && Math.abs(correction.dy) * 0.13 < 0.5) return;
    await moveMouseBy(page, correction.dx, correction.dy);
  }
  throw Error('Carrier native mouse aim did not converge');
}

export function registerClassicStorageCarrierJourney(test: typeof import('@playwright/test').test) {
  test('Classic 储运 v1 以真实右键和槽点击装卸、加煤、前进并保存重开', async ({ page }, info) => {
    test.skip(modularPackSmokeEnabled, 'Storage carriers belong to the Classic production Pack.');
    test.setTimeout(120_000);
    const seed = 'classic-native-storage-v1';
    try {
      await startClassicWorld(page, { ...classicScenario, seed });
      const artifact = await browserArtifact(page),
        packLock = await browserPackLock(page),
        composition = await compositionIdentity(page);
      expect(artifact.ok).toBe(true);
      expect(packLock.ok).toBe(true);
      expect(composition?.playbookId).toBe('seedlands:overworld');
      // The fixture is complete before native gameplay starts; all later mutations come from the product UI.
      await page.evaluate(async () => {
        const h = (window as unknown as ClassicWindow).__seedlandsHarness!;
        const command = async (input: Record<string, unknown>) => {
          const r = await h.world.command(input);
          if (!r.ok) throw Error(r.error.message);
          const result = r.data as {
            success?: boolean;
            data?: { player?: { inventory?: ({ itemId: string; count: number } | null)[]; mode?: { value: string } } };
          };
          if (result.success !== true) throw Error('Initial fixture command rejected: ' + JSON.stringify(result));
          return result;
        };
        if (!(await h.world.clock({ kind: 'pause' })).ok) throw Error('Fixture pause failed');
        const initial = await command({ type: 'query-player-state' });
        if (initial.data?.player?.mode?.value !== 'survival') throw Error('Initial player must be in Survival mode');
        for (const item of initial.data?.player?.inventory ?? [])
          if (item) await command({ type: 'remove-item', itemId: item.itemId, count: item.count });
        for (const fill of [
          { from: [-1, 30, -1], to: [12, 30, 3], voxel: 3 },
          { from: [-1, 31, -1], to: [12, 35, 3], voxel: 0 },
          { from: [1, 31, 0], to: [10, 31, 0], voxel: 39 },
        ] as const) {
          const r = await h.fillWorld(fill);
          if (!r || r.reason) throw Error('Fixture terrain rejected');
        }
        await command({ type: 'teleport', position: [2.5, 32.6, 2.5] });
        for (const [itemId, count] of [
          ['chest-minecart', 1],
          ['furnace-minecart', 1],
          ['plank', 5],
          ['coal', 2],
        ] as const)
          await command({ type: 'give-item', itemId, count });
        if (!(await h.world.clock({ kind: 'run' })).ok) throw Error('Fixture resume failed');
      });
      await lockPointer(page);
      await page.keyboard.press('Digit1');
      await aimAtVoxelWithRealMouse(page, [2, 31, 0], [2, 32, 0]);
      await clickCanvasCenter(page, 'right');
      await expect.poll(async () => (await carriers(page))?.transports.length).toBe(1);
      const cargo = (await carriers(page))!.transports[0]!;
      expect(cargo.definitionId).toBe('seedlands:chest-minecart');
      expect(cargo.rider).toBeNull();
      expect(cargo.inventory).toHaveLength(27);
      await expect
        .poll(() =>
          page.evaluate(
            (id) => (window as unknown as ClassicWindow).__seedlandsHarness!.presentedEntityModelReady(id),
            cargo.reference.entityId,
          ),
        )
        .toBe(true);
      await aimCarrier(page, cargo.pose.position);
      await info.attach('cargo-deployed.png', { body: await page.screenshot(), contentType: 'image/png' });
      await clickCanvasCenter(page, 'right');
      await expect(page.getByRole('dialog', { name: '载具货箱', exact: true })).toBeVisible();
      await page.locator('#transport-actor-slot-2').click();
      await page.locator('#transport-cargo-slot-26').click({ modifiers: ['Shift'] });
      await expect.poll(async () => (await carriers(page))?.transports[0]?.inventory[26]?.count).toBe(5);
      await page.locator('#transport-cargo-slot-26').click();
      await page.locator('#transport-actor-slot-2').click();
      await expect.poll(async () => (await carriers(page))?.transports[0]?.inventory[26]?.count).toBe(4);
      expect(
        (await playerState(page)).inventory
          .filter((item) => item?.itemId === 'plank')
          .reduce((sum, item) => sum + item!.count, 0),
      ).toBe(1);
      await info.attach('cargo-loaded-panel.png', { body: await page.screenshot(), contentType: 'image/png' });
      await page.locator('#transport-storage-close').click();
      await lockPointer(page);
      await page.keyboard.press('Digit2');
      await aimAtVoxelWithRealMouse(page, [5, 31, 0], [5, 32, 0]);
      await clickCanvasCenter(page, 'right');
      await expect.poll(async () => (await carriers(page))?.transports.length).toBe(2);
      const furnace = (await carriers(page))!.transports.find(
        (entry) => entry.definitionId === 'seedlands:furnace-minecart',
      )!;
      expect(furnace.fuel).toBe(0);
      expect(furnace.rider).toBeNull();
      await expect
        .poll(() =>
          page.evaluate(
            (id) => (window as unknown as ClassicWindow).__seedlandsHarness!.presentedEntityModelReady(id),
            furnace.reference.entityId,
          ),
        )
        .toBe(true);
      await aimCarrier(page, furnace.pose.position);
      await info.attach('furnace-deployed.png', { body: await page.screenshot(), contentType: 'image/png' });
      await clickCanvasCenter(page, 'right');
      await expect(page.getByRole('dialog', { name: '载具燃料', exact: true })).toBeVisible();
      await page.locator('#transport-actor-slot-3').click();
      await expect
        .poll(
          async () =>
            (await carriers(page))?.transports.find((entry) => entry.definitionId === 'seedlands:furnace-minecart')
              ?.fuel ?? 0,
        )
        .toBeGreaterThan(0);
      expect(
        (await playerState(page)).inventory
          .filter((item) => item?.itemId === 'coal')
          .reduce((sum, item) => sum + item!.count, 0),
      ).toBe(1);
      const fueled = (await carriers(page))!.transports.find(
        (entry) => entry.definitionId === 'seedlands:furnace-minecart',
      )!;
      await info.attach('furnace-fueled-panel.png', { body: await page.screenshot(), contentType: 'image/png' });
      await page.keyboard.press('Escape');
      await expect(page.locator('#inventory-crafting')).toBeHidden();
      await lockPointer(page);
      await expect
        .poll(
          async () =>
            (await carriers(page))!.transports.find((entry) => entry.definitionId === 'seedlands:furnace-minecart')!
              .pose.position[0] - fueled.pose.position[0],
        )
        .toBeGreaterThan(0.2);
      const moving = (await carriers(page))!.transports.find(
        (entry) => entry.definitionId === 'seedlands:furnace-minecart',
      )!;
      expect(moving.fuel).toBeLessThan(fueled.fuel!);
      expect(moving.rider).toBeNull();
      await aimCarrier(page, moving.pose.position);
      await info.attach('furnace-moving.png', { body: await page.screenshot(), contentType: 'image/png' });
      await expect
        .poll(
          async () =>
            Math.hypot(
              ...(await carriers(page))!.transports.find(
                (entry) => entry.definitionId === 'seedlands:furnace-minecart',
              )!.velocity,
            ),
          { timeout: 20_000 },
        )
        .toBe(0);
      await page.keyboard.press('Escape');
      const pause = page.getByRole('button', { name: '暂停游戏', exact: true });
      if (await pause.isVisible()) await pause.click();
      await expect.poll(async () => (await snapshot(page))?.authority.paused).toBe(true);
      const saved = (await carriers(page))!.transports;
      await page.getByRole('button', { name: '保存并返回主菜单', exact: true }).click();
      await page.locator('#start-card').waitFor({ state: 'visible' });
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('#seed').fill(seed);
      await page.getByRole('button', { name: '进入世界', exact: true }).click();
      await confirmClassicPerformanceWarning(page);
      await page.locator('#start-card').waitFor({ state: 'hidden' });
      await expect.poll(async () => (await carriers(page))?.transports.length).toBe(2);
      const restored = (await carriers(page))!.transports;
      for (const previous of saved)
        expect(restored.find((entry) => entry.definitionId === previous.definitionId)).toEqual({
          ...previous,
          reference: { ...previous.reference, epoch: previous.reference.epoch + 1 },
        });
      await info.attach('storage-save-reopen-state.json', {
        body: JSON.stringify({ artifact, packLock, composition, cargo, furnace, fueled, moving, saved, restored }),
        contentType: 'application/json',
      });
      await info.attach('storage-restored.png', { body: await page.screenshot(), contentType: 'image/png' });
    } catch (error) {
      await info.attach('storage-failure-diagnostics.json', {
        body: JSON.stringify(await collectClassicFailureDiagnostics(page)),
        contentType: 'application/json',
      });
      throw error;
    }
  });
}
