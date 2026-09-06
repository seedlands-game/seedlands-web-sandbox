import { expect, test } from '@playwright/test';
import { startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

test('自然河道白天黄昏的转头取证及水下反射关闭', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await startHarnessWorld(page, 'mosslight-68');
  await page.evaluate(() => {
    const h = window.__seedlandsHarness!;
    h.setSpectatorPosition(32.5, 13.1, -33.5);
    h.setView(0, -8);
    h.setTimePaused(true);
  });
  await waitForSnapshot(
    page,
    (s) =>
      s.visualEffects.reflectionActive &&
      s.generationQueue === 0 &&
      s.meshingQueue === 0 &&
      s.deferredRemeshes === 0 &&
      s.performance.uploadQueueDepth === 0,
  );
  await page.keyboard.press('F3');
  for (const time of [10, 18.35]) {
    for (const yaw of [-20, 0, 20]) {
      await page.evaluate(
        async ({ time, yaw }) => {
          const h = window.__seedlandsHarness!;
          h.setSpectatorPosition(32.5, 13.1, -33.5);
          h.setWorldTime(time);
          h.setView(yaw, -8);
          const engineUrl = performance
            .getEntriesByType('resource')
            .map((entry) => entry.name)
            .find((name) => name.includes('/playcanvas.js?v='))!;
          const pc = await import(engineUrl);
          const app = pc.Application.getApplication();
          for (let i = 0; i < 16; i++) await new Promise<void>((resolve) => app.once('postrender', resolve));
        },
        { time, yaw },
      );
      const shot = await page.screenshot({ path: `/tmp/natural-reflection-${time}-${yaw}.png` });
      await testInfo.attach(`river-${time}-${yaw}`, { body: shot, contentType: 'image/png' });
    }
  }
  await page.evaluate(() => window.__seedlandsHarness!.setSpectatorPosition(32.5, 10.2, -33.5));
  const submerged = await waitForSnapshot(page, (s) => s.water.cameraSubmerged && !s.visualEffects.reflectionActive);
  expect(submerged.visualEffects.reflectionEnabled).toBe(true);
});
