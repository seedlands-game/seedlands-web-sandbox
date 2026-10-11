import { registerEquipmentPrecisionJourney } from './equipment-precision-journey';
import { expect } from '@playwright/test';
import { startClassicWorld } from './start';
import { classicScenario } from './scenario';
import { snapshot, waitForSnapshot, walkTo, type ClassicWindow } from './harness';
import { lockPointer } from './mouse-input';
import { routeInputSettled } from './route-progress';
import { modularPackSmokeEnabled } from './modular-pack-smoke';

type NativeEvent = Readonly<{ type: string; code: string; key: string; trusted: boolean; repeat: boolean; at: number }>;
type NativeWindow = Window & { __classicNativeKeyboard?: NativeEvent[] };

/** Focused input contract in the canonical production spec, separate from C0-C5 acceptance. */
export function registerClassicNativeKeyboardJourney(test: typeof import('@playwright/test').test) {
  registerEquipmentPrecisionJourney(test);
  test('Classic 原生路线键盘保留可信 W/S/Space、真实位移与中性 Authority ACK', async ({ page }, testInfo) => {
    test.skip(modularPackSmokeEnabled, 'Native Classic route belongs to the Classic production Pack.');
    test.setTimeout(120_000);
    await startClassicWorld(page, classicScenario);
    // This focused input contract needs a local corridor, not the complete C0-C5 fixture.
    // Initial setup only; all observed movement below uses native input.
    await page.evaluate(async () => {
      const harness = (window as unknown as ClassicWindow).__seedlandsHarness!;
      const pause = await harness.world.clock({ kind: 'pause' });
      if (!pause.ok) throw new Error('Native keyboard fixture pause failed.');
      for (const fill of [
        { from: [-2, 30, -2], to: [6, 30, 2], voxel: 3 },
        { from: [-2, 31, -2], to: [6, 35, 2], voxel: 0 },
      ] as const) {
        const result = await harness.fillWorld(fill);
        if (!result || result.reason) throw new Error(`Native keyboard fixture rejected: ${result?.reason}`);
      }
      const teleport = await harness.world.command({ type: 'teleport', position: [0.5, 32.6, 0.5] });
      if (!teleport.ok) throw new Error('Native keyboard initial pose failed.');
      harness.setView(-90, -16);
      const run = await harness.world.clock({ kind: 'run' });
      if (!run.ok) throw new Error('Native keyboard fixture clock resume failed.');
    });
    await lockPointer(page);
    const before = await waitForSnapshot(page, (s) => s.onGround && routeInputSettled(s));
    await page.evaluate(() => {
      const events: NativeEvent[] = [];
      (window as NativeWindow).__classicNativeKeyboard = events;
      for (const type of ['keydown', 'keyup']) {
        window.addEventListener(
          type,
          (raw) => {
            const event = raw as KeyboardEvent;
            if (!['KeyW', 'KeyS', 'Space'].includes(event.code) || events.length >= 64) return;
            events.push({
              type: event.type,
              code: event.code,
              key: event.key,
              trusted: event.isTrusted,
              repeat: event.repeat,
              at: performance.now(),
            });
          },
          true,
        );
      }
    });
    const forward = await walkTo(page, [2.5, 0.5], { jump: true });
    const backward = await walkTo(page, [0.5, 0.5], { key: 'KeyS', jump: true });
    const events = await page.evaluate(() => (window as NativeWindow).__classicNativeKeyboard!);
    expect(events.length).toBeGreaterThanOrEqual(8);
    expect(events.length).toBeLessThan(64);
    expect(events.length % 4).toBe(0);
    expect(events.some((event) => event.code === 'KeyW')).toBe(true);
    expect(events.some((event) => event.code === 'KeyS')).toBe(true);
    for (let index = 0; index < events.length; index += 4) {
      const group = events.slice(index, index + 4),
        direction = group[0]!.code;
      expect(['KeyW', 'KeyS']).toContain(direction);
      expect(group.map((event) => [event.type, event.code])).toEqual([
        ['keydown', direction],
        ['keydown', 'Space'],
        ['keyup', direction],
        ['keyup', 'Space'],
      ]);
      for (const event of group) {
        expect(event.trusted).toBe(true);
        expect(event.repeat).toBe(false);
        expect(event.key).toBe(event.code === 'Space' ? ' ' : event.code === 'KeyW' ? 'w' : 's');
      }
    }
    expect(forward.serverPlayerPosition[0] - before.serverPlayerPosition[0]).toBeGreaterThan(0.75);
    expect(forward.serverPlayerPosition[0] - backward.serverPlayerPosition[0]).toBeGreaterThan(0.75);
    for (const state of [forward, backward]) {
      const release = state.nativeMovementInput?.release;
      expect(release?.code).toBe('Space');
      expect(release?.neutral).toBe(true);
      expect(state.authority.acknowledgedInputSequence).toBeGreaterThanOrEqual(release!.sequence);
      expect(routeInputSettled(state, release!.sequence)).toBe(true);
    }
    expect(await page.evaluate(() => document.pointerLockElement?.id)).toBe('game');
    await testInfo.attach('classic-native-keyboard-contract.json', {
      contentType: 'application/json',
      body: JSON.stringify({
        scope: 'Focused canonical production input contract; not full C0-C5 or performance acceptance',
        events,
        before,
        forward,
        backward,
        final: await snapshot(page),
      }),
    });
  });
}
