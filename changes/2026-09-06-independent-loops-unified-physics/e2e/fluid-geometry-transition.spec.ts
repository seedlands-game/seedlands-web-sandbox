import { expect, test } from '@playwright/test';
import { startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

test.setTimeout(60_000);

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
    h.setTimePaused(false);
    await h.setVoxelAt(1, 57, 0, 0);
  });
  const active = await expect
    .poll(() =>
      page.evaluate(() => {
        const transitions = (
          window.__seedlandsHarness!.snapshot() as unknown as {
            waterTransitions: {
              active: Array<{
                traceId: string;
                geometry?: {
                  mode: string;
                  patchCount: number;
                  visibleWaterMeshCount: number;
                  opacityCrossfade: boolean;
                };
              }>;
            };
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
        waterTransitions: {
          active: Array<{
            traceId: string;
            geometry?: {
              mode: string;
              patchCount: number;
              visibleWaterMeshCount: number;
              opacityCrossfade: boolean;
            };
          }>;
        };
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
        const transitions = (
          window.__seedlandsHarness!.snapshot() as unknown as {
            waterTransitions: { recent: Array<{ traceId: string; completed: boolean }> };
          }
        ).waterTransitions;
        return transitions.recent.some((record) => record.traceId === traceId && record.completed);
      }, held.traceId),
    )
    .toBe(true);
});
