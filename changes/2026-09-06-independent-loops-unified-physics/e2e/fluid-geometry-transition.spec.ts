import { expect, test } from '@playwright/test';
import { startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

test.setTimeout(60_000);

type WaterTransitionRecord = {
  chunkKey: string;
  targetRevision: number;
  traceId: string;
  progress: number;
  completed: boolean;
  superseded: boolean;
  geometry?: {
    mode: string;
    patchCount: number;
    visibleWaterMeshCount: number;
    opacityCrossfade: boolean;
  };
};

type WaterTransitions = {
  activeCount: number;
  active: WaterTransitionRecord[];
  recent: WaterTransitionRecord[];
};

test('已提交水边界使用单几何变形且静水重网格不启动过渡', async ({ page }) => {
  await startHarnessWorld(page, 'fluid-surface-morph-v1');
  await page.evaluate(async () => {
    const h = window.__seedlandsHarness!;
    h.setTimePaused(true);
    await h.fillWorld({ from: [-1, 56, -1], to: [5, 60, 1], voxel: 0 });
    await h.fillWorld({ from: [-1, 56, -1], to: [5, 56, 1], voxel: 3 });
    await h.fillWorld({ from: [-1, 57, -1], to: [5, 57, -1], voxel: 3 });
    await h.fillWorld({ from: [-1, 57, 1], to: [5, 57, 1], voxel: 3 });
    await h.setVoxelAt(-1, 57, 0, 3);
    await h.setVoxelAt(5, 57, 0, 3);
    await h.setVoxelAt(1, 57, 0, 3);
    await h.setVoxelAt(0, 57, 0, 8);
    h.movePlayerTo(2.5, 59.6, 5.5);
    h.setView(0, -24);
  });
  await waitForSnapshot(
    page,
    (state) =>
      state.generationQueue === 0 &&
      state.meshingQueue === 0 &&
      state.deferredRemeshes === 0 &&
      state.performance.uploadQueueDepth === 0,
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window.__seedlandsHarness!.snapshot() as unknown as { waterTransitions: { activeCount: number } })
            .waterTransitions.activeCount,
      ),
    )
    .toBe(0);
  const recentBefore = await page.evaluate(
    () =>
      (window.__seedlandsHarness!.snapshot() as unknown as { waterTransitions: { recent: unknown[] } }).waterTransitions
        .recent.length,
  );

  await page.evaluate(() => window.__seedlandsHarness!.setVoxelAt(3, 58, 1, 3));
  await waitForSnapshot(
    page,
    (state) => state.meshingQueue === 0 && state.deferredRemeshes === 0 && state.performance.uploadQueueDepth === 0,
  );
  expect(
    await page.evaluate(
      () =>
        (window.__seedlandsHarness!.snapshot() as unknown as { waterTransitions: { recent: unknown[] } })
          .waterTransitions.recent.length,
    ),
  ).toBe(recentBefore);

  await page.evaluate(async () => {
    const h = window.__seedlandsHarness!;
    h.setWaterTransitionHold?.(true);
    await h.setVoxelAt(1, 57, 0, 0);
  });
  const active = await expect
    .poll(() =>
      page.evaluate(() => {
        const transitions = (
          window.__seedlandsHarness!.snapshot() as unknown as {
            waterTransitions: WaterTransitions;
          }
        ).waterTransitions;
        return transitions.active.find((record) => record.geometry?.mode === 'surface-morph') ?? null;
      }),
    )
    .not.toBeNull();
  void active;
  const held = await page.evaluate(() => {
    const transitions = (
      window.__seedlandsHarness!.snapshot() as unknown as {
        waterTransitions: WaterTransitions;
      }
    ).waterTransitions;
    return transitions.active.find((record) => record.geometry?.mode === 'surface-morph')!;
  });
  expect(held.geometry).toMatchObject({
    mode: 'surface-morph',
    visibleWaterMeshCount: 1,
    opacityCrossfade: false,
  });
  expect(held.geometry!.patchCount).toBeGreaterThan(0);

  await page.evaluate(() => window.__seedlandsHarness!.setWaterTransitionHold?.(false));
  await expect
    .poll(() =>
      page.evaluate((traceId) => {
        const snapshot = window.__seedlandsHarness!.snapshot();
        const transitions = (snapshot as unknown as { waterTransitions: WaterTransitions }).waterTransitions;
        return (
          snapshot.meshingQueue === 0 &&
          snapshot.deferredRemeshes === 0 &&
          snapshot.performance.uploadQueueDepth === 0 &&
          transitions.activeCount === 0 &&
          transitions.recent.some((record) => record.traceId === traceId && record.completed && record.progress === 1)
        );
      }, held.traceId),
    )
    .toBe(true);

  await page.evaluate(async () => {
    const h = window.__seedlandsHarness!;
    h.setWaterTransitionHold?.(true);
    await h.setVoxelAt(1, 57, 0, 3);
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const transitions = (window.__seedlandsHarness!.snapshot() as unknown as { waterTransitions: WaterTransitions })
          .waterTransitions;
        return transitions.active.find((record) => record.geometry?.mode === 'surface-morph') ?? null;
      }),
    )
    .not.toBeNull();
  const interrupted = await page.evaluate(() => {
    const transitions = (window.__seedlandsHarness!.snapshot() as unknown as { waterTransitions: WaterTransitions })
      .waterTransitions;
    return transitions.active.find((record) => record.geometry?.mode === 'surface-morph')!;
  });

  await page.evaluate(() => window.__seedlandsHarness!.setVoxelAt(1, 57, 0, 0));
  await expect
    .poll(() =>
      page.evaluate((traceId) => {
        const transitions = (window.__seedlandsHarness!.snapshot() as unknown as { waterTransitions: WaterTransitions })
          .waterTransitions;
        const oldRecord = transitions.recent.find((record) => record.traceId === traceId);
        if (!oldRecord) return false;
        const successor = transitions.active.find(
          (record) => record.chunkKey === oldRecord.chunkKey && record.targetRevision > oldRecord.targetRevision,
        );
        return oldRecord?.superseded === true && oldRecord.completed === false && successor !== undefined;
      }, interrupted.traceId),
    )
    .toBe(true);
  const successor = await page.evaluate((traceId) => {
    const transitions = (window.__seedlandsHarness!.snapshot() as unknown as { waterTransitions: WaterTransitions })
      .waterTransitions;
    const oldRecord = transitions.recent.find((record) => record.traceId === traceId)!;
    return transitions.active.find(
      (record) => record.chunkKey === oldRecord.chunkKey && record.targetRevision > oldRecord.targetRevision,
    )!;
  }, interrupted.traceId);

  await page.evaluate(() => window.__seedlandsHarness!.setWaterTransitionHold?.(false));
  await expect
    .poll(() =>
      page.evaluate((traceId) => {
        const snapshot = window.__seedlandsHarness!.snapshot();
        const transitions = (snapshot as unknown as { waterTransitions: WaterTransitions }).waterTransitions;
        return {
          settled:
            snapshot.meshingQueue === 0 &&
            snapshot.deferredRemeshes === 0 &&
            snapshot.performance.uploadQueueDepth === 0,
          activeCount: transitions.activeCount,
          successorCompleted: transitions.recent.some(
            (record) => record.traceId === traceId && record.completed && record.progress === 1,
          ),
          recentCount: transitions.recent.length,
        };
      }, successor.traceId),
    )
    .toMatchObject({ settled: true, activeCount: 0, successorCompleted: true });
  expect(
    await page.evaluate(
      () =>
        (
          window.__seedlandsHarness!.snapshot() as unknown as {
            waterTransitions: WaterTransitions;
          }
        ).waterTransitions.recent.length,
    ),
  ).toBeLessThanOrEqual(32);
});
