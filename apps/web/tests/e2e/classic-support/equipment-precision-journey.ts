import { expect, type Page } from '@playwright/test';
import { startClassicWorld } from './start';
import { classicScenario } from './scenario';
import { snapshot, waitForSnapshot, type ClassicWindow } from './harness';
import { lockPointer } from './mouse-input';
import { routeInputSettled } from './route-progress';
import { nativeMovementPage } from './native-keyboard-port';
import { sendNativeMovementPulse } from './native-movement-pulse';
import { routePulseSettledPredicate } from './route-progress';
import { isInsideEquipmentRouteNeighborhood } from './equipment-resource-route';
import { modularPackSmokeEnabled } from './modular-pack-smoke';

type PrecisionEvent = Readonly<{ type: string; code: string; trusted: boolean; repeat: boolean; at: number }>;
type PrecisionWindow = Window & { __classicPrecisionEvents?: PrecisionEvent[] };

async function prepare(page: Page) {
  await startClassicWorld(page, classicScenario);
  await page.evaluate(async () => {
    const harness = (window as unknown as ClassicWindow).__seedlandsHarness!;
    if (!(await harness.world.clock({ kind: 'pause' })).ok) throw new Error('Precision fixture pause failed.');
    for (const fill of [
      { from: [-2, 30, -2], to: [6, 30, 2], voxel: 3 },
      { from: [-2, 31, -2], to: [6, 35, 2], voxel: 0 },
    ] as const) {
      const result = await harness.fillWorld(fill);
      if (!result || result.reason) throw new Error(`Precision fixture rejected: ${result?.reason}`);
    }
    if (!(await harness.world.command({ type: 'teleport', position: [0.5, 32.6, 0.5] })).ok)
      throw new Error('Precision fixture initial pose failed.');
    harness.setView(-90, -16);
    if (!(await harness.world.clock({ kind: 'run' })).ok) throw new Error('Precision fixture resume failed.');
  });
  await lockPointer(page);
  return waitForSnapshot(page, (value) => value.onGround && routeInputSettled(value));
}

export function registerEquipmentPrecisionJourney(test: typeof import('@playwright/test').test) {
  test('Classic 精确路线以可信原生脉冲保持原到达精度与中性 ACK', async ({ page }, info) => {
    test.skip(modularPackSmokeEnabled, 'Precision Classic route belongs to the Classic production Pack.');
    test.setTimeout(120_000);
    const before = await prepare(page);
    await page.evaluate(() => {
      const events: PrecisionEvent[] = [];
      (window as PrecisionWindow).__classicPrecisionEvents = events;
      for (const type of ['keydown', 'keyup'])
        window.addEventListener(
          type,
          (raw) => {
            const event = raw as KeyboardEvent;
            if (!['KeyW', 'KeyS'].includes(event.code) || events.length >= 128) return;
            events.push({
              type: event.type,
              code: event.code,
              trusted: event.isTrusted,
              repeat: event.repeat,
              at: performance.now(),
            });
          },
          true,
        );
    });
    const target = [0.8, 0.5] as const;
    const nativePage = await nativeMovementPage(page);
    const deadline = Date.now() + 45_000;
    let full = before;
    while (Math.abs(full.serverPlayerPosition[0] - target[0]) > 0.06) {
      if (Date.now() >= deadline) throw new Error('Native precision probe exceeded the original 45s route deadline.');
      const settled = routePulseSettledPredicate(full);
      await sendNativeMovementPulse(nativePage, full.serverPlayerPosition[0] < target[0] ? 'KeyW' : 'KeyS', 1);
      full = await waitForSnapshot(page, settled, 20_000, nativePage.snapshot);
      if (Date.now() >= deadline) throw new Error('Native precision probe exceeded the original 45s route deadline.');
    }
    const result = full;
    expect(Math.abs(result.player[0] - target[0])).toBeLessThanOrEqual(0.06);
    expect(isInsideEquipmentRouteNeighborhood(result.player, target)).toBe(true);
    expect(isInsideEquipmentRouteNeighborhood(result.serverPlayerPosition, target)).toBe(true);
    expect(result.onGround).toBe(true);
    expect(result.colliding).toBe(false);
    expect(result.serverPlayerPosition[0] - before.serverPlayerPosition[0]).toBeGreaterThan(0.23);
    full = (await snapshot(page))!;
    const release = full.nativeMovementInput?.release;
    expect(release?.neutral).toBe(true);
    expect(routeInputSettled(full, release!.sequence)).toBe(true);
    const events = await page.evaluate(() => (window as PrecisionWindow).__classicPrecisionEvents!);
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.length).toBeLessThan(128);
    expect(events.length % 2).toBe(0);
    for (let i = 0; i < events.length; i += 2) {
      expect(events[i]!.type).toBe('keydown');
      expect(events[i + 1]!.type).toBe('keyup');
      expect(events[i + 1]!.code).toBe(events[i]!.code);
      expect(events[i]!.trusted && events[i + 1]!.trusted).toBe(true);
      expect(events[i]!.repeat || events[i + 1]!.repeat).toBe(false);
    }
    expect(await page.evaluate(() => document.pointerLockElement?.id)).toBe('game');
    await info.attach('classic-equipment-precision-contract.json', {
      contentType: 'application/json',
      body: JSON.stringify({
        scope: 'Focused canonical minimal native input probe; planner activation/full C0-C5/performance not accepted',
        before,
        result,
        final: full,
        events,
      }),
    });
  });
}
