import { expect, test } from '@playwright/test';
import { startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

test.setTimeout(60_000);
test.use({ video: 'on' });

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

test('已提交水边界使用单几何变形且静水重网格不启动过渡', async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  await startHarnessWorld(page, 'fluid-surface-morph-v1');
  await page.evaluate(async () => {
    const h = window.__seedlandsHarness!;
    h.setTimePaused(true);
    await h.fillWorld({ from: [-3, 57, -3], to: [7, 65, 7], voxel: 0 });
    await h.fillWorld({ from: [-3, 56, -3], to: [7, 56, 7], voxel: 3 });
    // 三个独立封闭井，真实流体无需暂停也会稳定，日夜暂停只固定照明。
    await h.fillWorld({ from: [-1, 57, -1], to: [5, 57, 1], voxel: 3 });
    for (const x of [0, 2, 4]) await h.setVoxelAt(x, 57, 0, 0);
    await h.setVoxelAt(0, 57, 0, 8);
    await h.fillWorld({ from: [2, 61, 4], to: [2, 62, 4], voxel: 3 });
    // 固定俯视取证位避免井沿遮住合法的中间水位；只改变观察位置。
    await h.movePlayerTo(2.5, 64.6, 4.5);
    h.setView(0, -58);
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

  await page.evaluate(() => window.__seedlandsHarness!.setVoxelAt(6, 57, 6, 3));
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
  await testInfo.attach('water-morph-01-before', { body: await page.screenshot(), contentType: 'image/png' });

  await page.evaluate(async () => {
    const h = window.__seedlandsHarness!;
    h.setWaterTransitionHold?.(true);
    await h.setVoxelAt(2, 57, 0, 8);
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
  await page.waitForFunction((traceId) => {
    const h = window.__seedlandsHarness!;
    const transitions = (h.snapshot() as unknown as { waterTransitions: WaterTransitions }).waterTransitions;
    const frame = transitions.active.find((record) => record.traceId === traceId);
    if (!frame || frame.progress < 0.3 || frame.progress > 0.85) return false;
    h.setWaterTransitionHold?.(true);
    return true;
  }, held.traceId);
  await testInfo.attach('water-morph-02-middle', { body: await page.screenshot(), contentType: 'image/png' });
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
  await testInfo.attach('water-morph-03-complete', { body: await page.screenshot(), contentType: 'image/png' });

  await page.evaluate(async () => {
    const h = window.__seedlandsHarness!;
    h.setWaterTransitionHold?.(true);
    await h.setVoxelAt(2, 57, 0, 0);
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

  await page.evaluate(() => window.__seedlandsHarness!.setVoxelAt(4, 57, 0, 8));
  try {
    await expect
      .poll(() =>
        page.evaluate((traceId) => {
          const transitions = (
            window.__seedlandsHarness!.snapshot() as unknown as { waterTransitions: WaterTransitions }
          ).waterTransitions;
          const oldRecord = transitions.recent.find((record) => record.traceId === traceId);
          if (!oldRecord) return false;
          const successor = transitions.active.find(
            (record) => record.chunkKey === oldRecord.chunkKey && record.targetRevision > oldRecord.targetRevision,
          );
          return oldRecord?.superseded === true && oldRecord.completed === false && successor !== undefined;
        }, interrupted.traceId),
      )
      .toBe(true);
  } finally {
    await testInfo.attach('water-morph-runtime-errors', {
      body: JSON.stringify(pageErrors),
      contentType: 'application/json',
    });
    await testInfo.attach('water-morph-supersession-state', {
      body: JSON.stringify(await page.evaluate(() => window.__seedlandsHarness!.snapshot()), null, 2),
      contentType: 'application/json',
    });
    await testInfo.attach('water-morph-performance-trace', {
      body: JSON.stringify(await page.evaluate(() => window.__seedlandsHarness!.exportPerformanceTrace())),
      contentType: 'application/json',
    });
    await testInfo.attach('water-morph-final-cells', {
      body: JSON.stringify(
        await page.evaluate(() =>
          [0, 2, 4].map((x) => ({ x, voxel: window.__seedlandsHarness!.getVoxelAt!(x, 57, 0) })),
        ),
      ),
      contentType: 'application/json',
    });
    await testInfo.attach('water-morph-interrupted-identity', {
      body: JSON.stringify(interrupted, null, 2),
      contentType: 'application/json',
    });
  }
  const successor = await page.evaluate((traceId) => {
    const transitions = (window.__seedlandsHarness!.snapshot() as unknown as { waterTransitions: WaterTransitions })
      .waterTransitions;
    const oldRecord = transitions.recent.find((record) => record.traceId === traceId)!;
    return transitions.active.find(
      (record) => record.chunkKey === oldRecord.chunkKey && record.targetRevision > oldRecord.targetRevision,
    )!;
  }, interrupted.traceId);
  await testInfo.attach('water-morph-04-replacement', { body: await page.screenshot(), contentType: 'image/png' });

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
  expect(pageErrors).toEqual([]);
});
