import { expect, test } from '@playwright/test';
import { startHarnessWorld } from '../../../tests/e2e/support/harness';

test('source water opens through a gap, crosses a Chunk edge, retracts and preserves levels', async ({ page }) => {
  await startHarnessWorld(page, 'fluid-world-windowed-v2');
  const crossed = await page.evaluate(async () => {
    const harness = window.__seedlandsHarness!;
    if (!harness.advanceFluid || !harness.getFluidCell) throw new Error('Fluid harness is not connected.');
    for (let z = -2; z <= 2; z += 1)
      for (let x = 29; x <= 35; x += 1) {
        harness.setVoxelAt(x, 57, z, 3);
        for (let y = 58; y <= 61; y += 1) harness.setVoxelAt(x, y, z, 0);
      }
    for (let x = 29; x <= 32; x += 1) {
      harness.setVoxelAt(x, 58, -1, 3);
      harness.setVoxelAt(x, 58, 1, 3);
    }
    harness.setVoxelAt(29, 58, 0, 3);
    harness.setVoxelAt(32, 58, 0, 3);
    harness.setVoxelAt(31, 58, 0, 8);
    harness.advanceFluid(0.8);
    const sealed = harness.getFluidCell(33, 58, 0);
    harness.setVoxelAt(32, 58, 0, 0);
    harness.advanceFluid(0.8);
    const level = harness.getFluidCell(33, 58, 0);
    await harness.flushSave();
    return { sealed, level };
  });
  expect(crossed.sealed).toBeNull();
  expect(crossed.level).toEqual({ level: 6, source: false });
  await page.evaluate(() => window.__seedlandsHarness!.restartWorld('fluid-world-windowed-v2'));
  await expect
    .poll(() => page.evaluate(() => window.__seedlandsHarness?.getFluidCell?.(33, 58, 0) ?? 'loading'))
    .toEqual({ level: 6, source: false });
  const reflectionProbe = await page.evaluate(async () => {
    const harness = window.__seedlandsHarness!;
    harness.setVoxelAt(31, 58, 7, 8);
    harness.setSpectatorPosition(31.5, 62.5, 7.5);
    harness.setView(0, -24);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return harness.getFluidCell!(31, 58, 7);
  });
  expect(reflectionProbe).toEqual({ level: 8, source: true });
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const snapshot = window.__seedlandsHarness!.snapshot();
          return {
            rendered: snapshot.renderedChunks > 4,
            geometry: snapshot.triangles >= 50,
            streamingIdle:
              snapshot.generationQueue === 0 &&
              snapshot.meshingQueue === 0 &&
              snapshot.deferredRemeshes === 0 &&
              snapshot.performance.uploadQueueDepth === 0,
            reflection: snapshot.visualEffects.reflectionActive,
            waterPlaneY: snapshot.visualEffects.waterPlaneY,
          };
        }),
      { timeout: 30_000 },
    )
    .toEqual({ rendered: true, geometry: true, streamingIdle: true, reflection: true, waterPlaneY: 58.875 });
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  await page.screenshot({ path: '/tmp/seedlands-fluid-level-evidence.png' });
  const retracted = await page.evaluate(() => {
    const harness = window.__seedlandsHarness!;
    harness.setVoxelAt(31, 58, 0, 0);
    for (let index = 0; index < 12; index += 1) harness.advanceFluid!(0.8);
    return harness.getFluidCell!(33, 58, 0);
  });
  expect(retracted).toBeNull();
});
