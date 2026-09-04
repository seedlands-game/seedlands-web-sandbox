import { expect, test } from '@playwright/test';
import { moveHarnessPlayer, snapshot, startHarnessWorld } from '../../../tests/e2e/support/harness';

test('captures an end-to-end streaming profile without losing integrated server authority', async ({ page }) => {
  await startHarnessWorld(page, 'client-performance-observability');
  const scenarioId = await page.evaluate(() =>
    window.__seedlandsHarness?.beginPerformanceScenario('boundary-crossing'),
  );
  expect(scenarioId).toBeTruthy();
  await moveHarnessPlayer(page, 40, 34, 0);
  await page.waitForFunction((expectedScenarioId) => {
    const current = window.__seedlandsHarness?.snapshot();
    if (!current) return false;
    return current.performance.scenarioId === expectedScenarioId && current.performance.completedChunkTraces > 0;
  }, scenarioId);
  const profiled = await snapshot(page);
  expect(profiled).not.toBeNull();
  if (!profiled) throw new Error('性能 Harness 快照不可用。');

  expect(profiled.performance.frame.count).toBeGreaterThan(0);
  expect(profiled.performance.chunkVisible.p95Ms).toBeGreaterThanOrEqual(0);
  expect(profiled.performance.maxMeshCommitsInFrame).toBeLessThanOrEqual(1);
  expect(profiled.performance.maxMeshPartsInFrame).toBeGreaterThan(0);
  expect(profiled.performance.visibleAfterPostrender).toBe(true);
  expect(profiled.performance.traceEventCount).toBeGreaterThan(0);
  expect(profiled.player).toEqual(profiled.serverPlayerPosition);

  const chromeTrace = await page.evaluate(() => window.__seedlandsHarness?.exportPerformanceTrace());
  expect(chromeTrace?.traceEvents.some((event) => event.cat === 'chunk-request')).toBe(true);
});
