import { expect, type Page } from '@playwright/test';
import { modularPackSmokeEnabled } from './modular-pack-smoke';
import { startClassicWorld } from './start';
import { classicScenario } from './scenario';
import { aimAtVoxelWithRealMouse } from './aim';
import { snapshot, closeInventory, lockPointer, clickCanvasCenter, moveMouseBy, type ClassicWindow } from './harness';
import { mouseCorrectionToPoint } from './target-aim';
import { sendNativeMovementPulse } from './native-movement-pulse';
import { browserArtifact, browserPackLock, compositionIdentity } from './identity';
import { collectClassicFailureDiagnostics } from './evidence';
const transport = (page: Page) =>
  page.evaluate(() => (window as unknown as ClassicWindow).__seedlandsHarness!.transportSnapshot());
async function aimBoat(page: Page, position: readonly number[]) {
  for (let attempt = 0; attempt < 18; attempt++) {
    const state = await snapshot(page);
    if (!state) throw Error('accepted player snapshot missing');
    const correction = mouseCorrectionToPoint(state.player, state.viewAngles, [
      position[0],
      position[1] + 0.3,
      position[2],
    ]);
    if (Math.abs(correction.dx) * 0.13 < 0.5 && Math.abs(correction.dy) * 0.13 < 0.5) return;
    await moveMouseBy(page, correction.dx, correction.dy);
  }
  throw Error('boat native mouse aim did not converge');
}
export function registerClassicBoatJourney(test: typeof import('@playwright/test').test) {
  test('Classic 船以原生输入部署、前进、转向、倒退并驶回岸边下船', async ({ page }, info) => {
    test.skip(modularPackSmokeEnabled, 'Boat belongs to the Classic production Pack.');
    test.setTimeout(120_000);
    try {
      await startClassicWorld(page, { ...classicScenario, seed: 'classic-native-boat-952' });
      const artifact = await browserArtifact(page),
        packLock = await browserPackLock(page),
        composition = await compositionIdentity(page);
      expect(artifact.ok).toBe(true);
      expect(packLock.ok).toBe(true);
      expect(composition?.playbookId).toBe('seedlands:overworld');
      await page.evaluate(async () => {
        const h = (window as unknown as ClassicWindow).__seedlandsHarness!;
        if (!(await h.world.clock({ kind: 'pause' })).ok) throw Error('fixture pause failed');
        for (const command of [
          { from: [-3, 30, -3], to: [8, 30, 8], voxel: 3 },
          { from: [-3, 31, -3], to: [8, 36, 8], voxel: 0 },
          { from: [-3, 31, -3], to: [8, 31, 8], voxel: 8 },
          { from: [2, 31, 2], to: [2, 31, 2], voxel: 3 },
          { from: [4, 31, -1], to: [4, 31, 5], voxel: 3 },
        ] as const) {
          const r = await h.fillWorld(command);
          if (!r || r.reason) throw Error('boat fixture rejected ' + r?.reason);
        }
        if (!(await h.world.command({ type: 'teleport', position: [2.5, 32.6, 2.5] })).ok)
          throw Error('fixture teleport failed');
        if (!(await h.world.clock({ kind: 'run' })).ok) throw Error('fixture resume failed');
      });
      await lockPointer(page);
      await page.keyboard.press('KeyE');
      const inventory = page.getByRole('dialog', { name: '背包与合成' });
      await expect(inventory).toBeVisible();
      await inventory.getByRole('button', { name: '切换创造模式', exact: true }).click();
      const catalog = page.getByRole('dialog', { name: '创造内容目录' });
      await expect(catalog).toBeVisible();
      await catalog.locator('#creative-item-filter').fill('船');
      await catalog.getByRole('button', { name: /^将船放入创造快捷栏 / }).click();
      await closeInventory(page);
      await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('game');
      await expect(page.locator('#hotbar button[aria-pressed="true"]')).toHaveAttribute('data-item', 'boat');
      await aimAtVoxelWithRealMouse(page, [2, 31, 0], [2, 32, 0]);
      await clickCanvasCenter(page, 'right');
      await expect.poll(async () => (await transport(page))?.transports.length).toBe(1);
      const deployed = (await transport(page))!.transports[0]!;
      expect(deployed.definitionId).toBe('seedlands:boat');
      expect(deployed.rider).toBeNull();
      await expect
        .poll(() =>
          page.evaluate(
            (id) => (window as unknown as ClassicWindow).__seedlandsHarness!.presentedEntityModelReady(id),
            deployed.reference.entityId,
          ),
        )
        .toBe(true);
      await aimBoat(page, deployed.pose.position);
      await info.attach('boat-deployed.png', { body: await page.screenshot(), contentType: 'image/png' });
      await clickCanvasCenter(page, 'right');
      await expect.poll(async () => (await transport(page))?.transports[0]?.rider?.entityId).toBeDefined();
      const mounted = (await transport(page))!.transports[0]!;
      const departureView = await snapshot(page);
      if (!departureView) throw Error('departure snapshot missing');
      const departureFace = mouseCorrectionToPoint(
        departureView.player,
        departureView.viewAngles,
        [departureView.player[0], departureView.player[1], departureView.player[2] + 4],
        { wholeTurn: true },
      );
      await moveMouseBy(page, departureFace.dx, departureFace.dy);
      await sendNativeMovementPulse(page, 'KeyS', 1200, false);
      await expect
        .poll(async () => (await transport(page))!.transports[0]!.pose.position[2], { timeout: 10_000 })
        .toBeLessThan(mounted.pose.position[2] - 0.05);
      await expect
        .poll(async () => Math.hypot(...(await transport(page))!.transports[0]!.velocity), { timeout: 10_000 })
        .toBeLessThan(0.05);
      const clearWater = (await transport(page))!.transports[0]!;
      const before = await snapshot(page);
      if (!before) throw Error('movement snapshot missing');
      const forward = mouseCorrectionToPoint(
        before.player,
        before.viewAngles,
        [before.player[0], before.player[1], before.player[2] + 4],
        { wholeTurn: true },
      );
      await moveMouseBy(page, forward.dx, forward.dy);
      await sendNativeMovementPulse(page, 'KeyW', 300, false);
      await expect
        .poll(async () => (await transport(page))!.transports[0]!.pose.position[2], { timeout: 10_000 })
        .toBeGreaterThan(clearWater.pose.position[2] + 0.05);
      const moved = (await transport(page))!.transports[0]!;
      const next = await snapshot(page);
      if (!next) throw Error('steering snapshot missing');
      const right = mouseCorrectionToPoint(
        next.player,
        next.viewAngles,
        [next.player[0] + 4, next.player[1], next.player[2] + 4],
        { wholeTurn: true },
      );
      await moveMouseBy(page, right.dx, right.dy);
      await sendNativeMovementPulse(page, 'KeyW', 300, false);
      await expect
        .poll(async () => (await transport(page))!.transports[0]!.pose.yaw, { timeout: 10_000 })
        .toBeGreaterThan(moved.pose.yaw + 0.01);
      const reverseStart = (await transport(page))!.transports[0]!;
      const reverseView = await snapshot(page);
      if (!reverseView) throw Error('reverse snapshot missing');
      const reverseFace = mouseCorrectionToPoint(
        reverseView.player,
        reverseView.viewAngles,
        [reverseView.player[0], reverseView.player[1], reverseView.player[2] + 4],
        { wholeTurn: true },
      );
      await moveMouseBy(page, reverseFace.dx, reverseFace.dy);
      await sendNativeMovementPulse(page, 'KeyS', 1200, false);
      await expect
        .poll(async () => (await transport(page))!.transports[0]!.pose.position[2], { timeout: 10_000 })
        .toBeLessThan(reverseStart.pose.position[2] - 0.05);
      const reversed = (await transport(page))!.transports[0]!;
      const shoreGoal = [2.9, 0.5] as const;
      for (let attempt = 0; attempt < 40; attempt++) {
        const boat = (await transport(page))!.transports[0]!;
        if (Math.hypot(boat.pose.position[0] - shoreGoal[0], boat.pose.position[2] - shoreGoal[1]) < 0.3) break;
        const view = await snapshot(page);
        if (!view) throw Error('shore navigation snapshot missing');
        const correction = mouseCorrectionToPoint(
          view.player,
          view.viewAngles,
          [shoreGoal[0], view.player[1], shoreGoal[1]],
          { wholeTurn: true },
        );
        await moveMouseBy(page, correction.dx, correction.dy);
        await sendNativeMovementPulse(page, 'KeyW', 300, false);
      }
      const returned = (await transport(page))!.transports[0]!;
      expect(
        Math.hypot(returned.pose.position[0] - shoreGoal[0], returned.pose.position[2] - shoreGoal[1]),
      ).toBeLessThan(0.3);
      await page.keyboard.down('ShiftLeft');
      try {
        await clickCanvasCenter(page, 'right');
      } finally {
        await page.keyboard.up('ShiftLeft');
      }
      await expect.poll(async () => (await transport(page))?.transports[0]?.rider).toBeNull();
      await expect.poll(async () => (await snapshot(page))?.onGround).toBe(true);
      const final = (await transport(page))!.transports[0]!;
      expect(final.reference).toEqual(deployed.reference);
      await info.attach('boat-final.png', { body: await page.screenshot(), contentType: 'image/png' });
      await info.attach('boat-native-result.json', {
        body: JSON.stringify({
          scope: 'NON_MAIN',
          artifact,
          packLock,
          composition,
          deployed,
          mounted,
          clearWater,
          moved,
          reverseStart,
          reversed,
          returned,
          final,
          finalSnapshot: await snapshot(page),
        }),
        contentType: 'application/json',
      });
    } catch (error) {
      await info.attach('boat-current-state.json', {
        body: JSON.stringify({ transport: await transport(page), snapshot: await snapshot(page) }),
        contentType: 'application/json',
      });
      await info.attach('boat-native-failure.json', {
        body: JSON.stringify(await collectClassicFailureDiagnostics(page)),
        contentType: 'application/json',
      });
      throw error;
    }
  });
}
