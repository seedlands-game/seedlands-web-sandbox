import { test } from '@playwright/test';
import { startHarnessWorld } from '../support/harness';
import { writeBrowserBenchmarkResult } from '../support/result';

test('collects an environment-scoped initial world readiness sample', async ({ page }) => {
  const startedAt = performance.now();
  await startHarnessWorld(page, 'seedlands-playwright-benchmark');
  await writeBrowserBenchmarkResult(performance.now() - startedAt);
});
