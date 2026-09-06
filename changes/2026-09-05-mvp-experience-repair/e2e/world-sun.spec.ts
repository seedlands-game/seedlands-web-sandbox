import { expect, test } from '@playwright/test';
import { startHarnessWorld } from '../../../tests/e2e/support/harness';

test('the sun keeps a world direction and leaves the view when the player turns away', async ({ page }) => {
  await startHarnessWorld(page, 'world-sun-change');
  const samples = await page.evaluate(async () => {
    const harness = window.__seedlandsHarness!;
    if (!harness.sunSnapshot) throw new Error('World-space sun harness is not connected.');
    const sample = async (yaw: number) => {
      harness.setView(yaw, 0);
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return harness.sunSnapshot!();
    };
    harness.setWorldTime(9);
    harness.setTimePaused(true);
    const forward = await sample(0);
    const side = await sample(90);
    const away = await sample(180);
    return { forward, side, away };
  });
  samples.side.direction.forEach((value, index) => expect(value).toBeCloseTo(samples.forward.direction[index], 4));
  samples.away.direction.forEach((value, index) => expect(value).toBeCloseTo(samples.forward.direction[index], 4));
  expect(samples.side.screen).not.toEqual(samples.forward.screen);
  expect(samples.forward.facing).toBe(true);
  expect(samples.away.facing).toBe(false);
  const visibleYaw = await page.evaluate(async () => {
    const harness = window.__seedlandsHarness!;
    for (const pitch of [-60, -30, 0, 30, 60])
      for (let yaw = -180; yaw < 180; yaw += 10) {
        harness.setView(yaw, pitch);
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const snapshot = harness.sunSnapshot!();
        if (
          snapshot.facing &&
          snapshot.screen &&
          snapshot.screen[0] > 0 &&
          snapshot.screen[0] < innerWidth &&
          snapshot.screen[1] > 0 &&
          snapshot.screen[1] < innerHeight
        )
          return { yaw, pitch };
      }
    return null;
  });
  expect(visibleYaw).not.toBeNull();
  await page.screenshot({ path: '/tmp/seedlands-world-sun-forward-evidence.png' });
  await page.evaluate(async ({ yaw, pitch }) => {
    window.__seedlandsHarness!.setView(yaw + 180, pitch);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }, visibleYaw!);
  await page.screenshot({ path: '/tmp/seedlands-world-sun-away-evidence.png' });
});
