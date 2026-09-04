import { expect, test } from '@playwright/test';
import { snapshot, startHarnessWorld } from '../../../tests/e2e/support/harness';
import { writePerformanceComparisonResult } from '../../../tests/e2e/support/result';

type Variant = 'main-snapshot' | 'worker-first';
type Sample = {
  variant: Variant;
  frame: { p50Ms: number; p95Ms: number; p99Ms: number; maxMs: number; longFrameCount: number };
  chunkVisible: { count: number; p50Ms: number; p95Ms: number; p99Ms: number; maxMs: number };
  completedChunkTraces: number;
  visibleAfterPostrender: boolean;
};

test('以交错 A/B 留存 Worker-first 的固定 crossing 性能样本', async ({ page }) => {
  test.setTimeout(90_000);
  const order: Variant[] = Array.from({ length: 5 }, () => ['main-snapshot', 'worker-first'] as const).flat();
  const samples: Sample[] = [];
  for (const [index, variant] of order.entries()) {
    await startHarnessWorld(page, 'worker-first-ab', `&streamingVariant=${variant}`);
    const scenarioId = await page.evaluate(() => window.__seedlandsHarness?.beginPerformanceScenario('ab-crossing'));
    await page.evaluate((x) => window.__seedlandsHarness?.setSpectatorPosition(x, 34, 0), 256 + index * 192);
    await page.waitForFunction(
      (expected) => {
        const current = window.__seedlandsHarness?.snapshot();
        return Boolean(
          current &&
          current.performance.scenarioId === expected &&
          current.performance.completedChunkTraces >= 20 &&
          current.performance.visibleAfterPostrender,
        );
      },
      scenarioId,
      { timeout: 30_000 },
    );
    const current = await snapshot(page);
    if (!current) throw new Error('A/B Harness 快照不可用。');
    expect(current.player).toEqual(current.serverPlayerPosition);
    samples.push({
      variant,
      frame: current.performance.frame,
      chunkVisible: current.performance.chunkVisible,
      completedChunkTraces: current.performance.completedChunkTraces,
      visibleAfterPostrender: current.performance.visibleAfterPostrender,
    });
  }
  await writePerformanceComparisonResult('worker-first-ab.json', {
    status: 'PASS',
    scenario: 'crossing-after-initial-queue',
    order,
    requiredCompletedChunksPerVariant: 20,
    samples,
    gpuTiming: 'NOT_COLLECTED',
  });
  expect(samples.filter((sample) => sample.variant === 'main-snapshot')).toHaveLength(2);
  expect(samples.filter((sample) => sample.variant === 'worker-first')).toHaveLength(2);
});
