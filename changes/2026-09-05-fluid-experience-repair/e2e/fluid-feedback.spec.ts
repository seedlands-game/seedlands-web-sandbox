import { expect, test } from '@playwright/test';
import { startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

test.setTimeout(60_000);

test('warm 缺口编辑完成 20 次 edit 到 postrender 分段且持续流动可见', async ({ page }) => {
  await startHarnessWorld(page, 'fluid-feedback-v3');
  await page.evaluate(() => {
    const h = window.__seedlandsHarness!;
    h.movePlayerTo(0.5, 60.6, 0.5);
    for (let z = -2; z <= 2; z += 1)
      for (let x = -2; x <= 4; x += 1) {
        h.setVoxelAt(x, 56, z, 3);
        for (let y = 57; y <= 60; y += 1) h.setVoxelAt(x, y, z, 0);
      }
    for (let z = -1; z <= 1; z += 1) for (let x = -1; x <= 1; x += 1) if (x !== 0 || z !== 0) h.setVoxelAt(x, 57, z, 3);
    h.setVoxelAt(2, 57, 0, 3);
    h.setVoxelAt(0, 57, 0, 8);
  });
  await waitForSnapshot(
    page,
    (state) =>
      state.generationQueue === 0 &&
      state.meshingQueue === 0 &&
      state.deferredRemeshes === 0 &&
      state.performance.uploadQueueDepth === 0,
  );

  for (let index = 0; index < 20; index += 1) {
    await page.evaluate(() => {
      const h = window.__seedlandsHarness!;
      h.beginFluidFeedbackSample?.();
      h.setVoxelAt(1, 57, 0, 0);
    });
    await expect
      .poll(() => page.evaluate(() => window.__seedlandsHarness!.snapshot().fluidFeedback.count))
      .toBeGreaterThanOrEqual(index + 1);
    expect((await page.evaluate(() => window.__seedlandsHarness!.snapshot().fluidFeedback)).pending).toBe(false);
    await page.evaluate(() => window.__seedlandsHarness!.setVoxelAt(1, 57, 0, 3));
    await expect
      .poll(() => page.evaluate(() => window.__seedlandsHarness?.getFluidCell?.(1, 57, 0) ?? null))
      .toBeNull();
    await waitForSnapshot(
      page,
      (state) =>
        state.generationQueue === 0 &&
        state.meshingQueue === 0 &&
        state.deferredRemeshes === 0 &&
        state.performance.uploadQueueDepth === 0,
    );
  }

  const summary = await page.evaluate(() => window.__seedlandsHarness!.snapshot().fluidFeedback);
  expect(summary.count).toBe(20);
  expect(summary.samples).toHaveLength(20);
  expect(summary.samples.every((sample) => sample.editToCommitMs >= 0 && sample.totalMs > 0)).toBe(true);
  expect(summary.samples.every((sample) => sample.workerMs >= 0 && sample.attachToVisibleMs >= 0)).toBe(true);
  console.info(`FLUID_FEEDBACK_SUMMARY ${JSON.stringify(summary)}`);

  const progression = await page.evaluate(async () => {
    const h = window.__seedlandsHarness!;
    for (let x = 2; x <= 4; x += 1) h.setVoxelAt(x, 57, 0, 0);
    h.setVoxelAt(1, 57, 0, 0);
    const frames: Array<{ at: number; levels: Array<number | null>; complete: number }> = [];
    const started = performance.now();
    while (performance.now() - started < 1_200) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      frames.push({
        at: performance.now() - started,
        levels: [1, 2, 3, 4].map((x) => h.getFluidCell?.(x, 57, 0)?.level ?? null),
        complete: h.snapshot().performance.completedChunkTraces,
      });
    }
    return frames;
  });
  const distinctAuthorityFronts = new Set(progression.map((frame) => JSON.stringify(frame.levels)));
  const visibleTraceCounts = new Set(progression.map((frame) => frame.complete));
  expect(distinctAuthorityFronts.size).toBeGreaterThan(2);
  expect(visibleTraceCounts.size).toBeGreaterThan(1);
  console.info(`FLUID_PROGRESS_FRAMES ${JSON.stringify(progression)}`);
});
