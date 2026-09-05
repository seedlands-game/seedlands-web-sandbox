import { expect, test } from '@playwright/test';
import { startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

test.setTimeout(60_000);

test('warm 缺口编辑完成 20 次 edit 到 postrender 分段且持续流动可见', async ({ page }) => {
  await startHarnessWorld(page, 'fluid-feedback-v3');
  await page.evaluate(() => {
    const h = window.__seedlandsHarness!;
    h.movePlayerTo(0.5, 60.6, 5.5);
    h.setView(0, -28);
    for (let z = -2; z <= 8; z += 1)
      for (let x = -3; x <= 4; x += 1) {
        h.setVoxelAt(x, 56, z, 3);
        for (let y = 57; y <= 63; y += 1) h.setVoxelAt(x, y, z, 0);
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
  expect(summary.samples.every((sample) => sample.visibleRevision >= sample.targetRevision)).toBe(true);
  expect(
    summary.samples.every((sample) => sample.targetChunkKey === '0,1,0' && sample.traceId.startsWith('trace-')),
  ).toBe(true);
  console.info(`FLUID_FEEDBACK_SUMMARY ${JSON.stringify(summary)}`);
  expect(summary.p95Ms).toBeLessThanOrEqual(100);

  const progression = await page.evaluate(async () => {
    const h = window.__seedlandsHarness!;
    for (let x = 2; x <= 4; x += 1) h.setVoxelAt(x, 57, 0, 0);
    h.setVoxelAt(1, 57, 0, 0);
    const frames: Array<{
      at: number;
      levels: Array<number | null>;
      transitions: ReturnType<typeof h.snapshot>['waterTransitions'];
    }> = [];
    const started = performance.now();
    while (performance.now() - started < 1_200) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const transitions = h.snapshot().waterTransitions;
      frames.push({
        at: performance.now() - started,
        levels: [1, 2, 3, 4].map((x) => h.getFluidCell?.(x, 57, 0)?.level ?? null),
        transitions: {
          ...transitions,
          recent: transitions.recent.slice(-4),
        },
      });
    }
    return frames;
  });
  const distinctAuthorityFronts = new Set(progression.map((frame) => JSON.stringify(frame.levels)));
  expect(distinctAuthorityFronts.size).toBeGreaterThan(2);
  const observed = progression.flatMap((frame) => [...frame.transitions.active, ...frame.transitions.recent]);
  const targetTransitions = new Map(
    observed.filter((record) => record.chunkKey === '0,1,0').map((record) => [record.traceId, record]),
  );
  expect(new Set([...targetTransitions.values()].map((record) => record.targetRevision)).size).toBeGreaterThan(1);
  expect(
    [...targetTransitions.values()].some(
      (record) => record.progressSamples.some((progress) => progress > 0.12 && progress < 1) && record.frameCount >= 2,
    ),
  ).toBe(true);
  for (const record of targetTransitions.values())
    expect(
      record.progressSamples.every((progress, index) => index === 0 || progress >= record.progressSamples[index - 1]),
    ).toBe(true);

  await expect
    .poll(() => page.evaluate(() => window.__seedlandsHarness!.snapshot().waterTransitions.activeCount))
    .toBe(0);
  const settledTransitions = await page.evaluate(() => window.__seedlandsHarness!.snapshot().waterTransitions.recent);
  expect(
    settledTransitions.some((record) => record.chunkKey === '0,1,0' && record.completed && record.progress === 1),
  ).toBe(true);

  await page.evaluate(() => window.__seedlandsHarness!.setVoxelAt(4, 57, 0, 3));
  await expect.poll(() => page.evaluate(() => window.__seedlandsHarness?.getFluidCell?.(4, 57, 0) ?? null)).toBeNull();
  await page.evaluate(() => window.__seedlandsHarness!.setVoxelAt(4, 57, 0, 0));
  await expect
    .poll(() =>
      page.evaluate(() =>
        window
          .__seedlandsHarness!.snapshot()
          .waterTransitions.active.some((record) => record.progress > 0.12 && record.progress < 1),
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: 'changes/2026-09-05-fluid-experience-repair/evidence/fluid-front-transition.png',
  });
  console.info(
    `FLUID_VISUAL_TRANSITIONS ${JSON.stringify(
      [...targetTransitions.values()].map(
        ({ chunkKey, targetRevision, traceId, progressSamples, completed, superseded }) => ({
          chunkKey,
          targetRevision,
          traceId,
          progressSamples,
          completed,
          superseded,
        }),
      ),
    )}`,
  );
});
