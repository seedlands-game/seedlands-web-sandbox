import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { startHarnessWorld } from '../../../tests/e2e/support/harness';

type Trace = {
  traceEvents: Array<{ name: string; cat: string; dur: number }>;
};

type PerformanceHarnessWindow = Window & {
  __seedlandsHarness?: {
    snapshot: () => {
      frameMs: number;
      performance: {
        frame: { count: number; p50Ms: number; p95Ms: number; p99Ms: number; longFrameCount: number };
        estimatedMeshBytes: number;
      };
      ui?: Record<string, number | string>;
    };
    beginPerformanceScenario: (name: string) => string;
    exportPerformanceTrace: () => Trace;
  };
};

test('records a fixed retained UI A/B browser sample', async ({ page }) => {
  await startHarnessWorld(page, 'retained-ui-performance');
  await page.keyboard.press('F3');
  await page.evaluate(() => (window as PerformanceHarnessWindow).__seedlandsHarness?.beginPerformanceScenario('ui-ab'));
  const startedAt = performance.now();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let frames = 0;
        const next = () => {
          frames += 1;
          if (frames >= 360) resolve();
          else requestAnimationFrame(next);
        };
        requestAnimationFrame(next);
      }),
  );
  const durationMs = performance.now() - startedAt;
  const sample = await page.evaluate(() => {
    const harness = (window as PerformanceHarnessWindow).__seedlandsHarness;
    if (!harness) throw new Error('Harness unavailable.');
    const snapshot = harness.snapshot();
    const trace = harness.exportPerformanceTrace();
    const uiSpans = trace.traceEvents.filter((event) => event.cat === 'hud' || event.cat === 'ui');
    return {
      runtime: document.querySelector('#ui')?.getAttribute('data-ui-runtime') ?? 'manual-dom',
      frame: snapshot.performance.frame,
      estimatedMeshBytes: snapshot.performance.estimatedMeshBytes,
      ui: snapshot.ui ?? null,
      uiSpanCount: uiSpans.length,
      uiSpanDurationMs: uiSpans.reduce((total, event) => total + event.dur / 1000, 0),
    };
  });
  const result = {
    sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    browser: 'chromium',
    viewport: '1280x720',
    seed: 'retained-ui-performance',
    quality: 'medium',
    frames: 360,
    durationMs: Math.round(durationMs * 100) / 100,
    ...sample,
  };
  console.log(`SEEDLANDS_UI_AB=${JSON.stringify(result)}`);
  expect(sample.frame.count).toBeGreaterThan(0);
  expect(sample.frame.p95Ms).toBeGreaterThanOrEqual(0);
  if (sample.runtime === 'svelte5') {
    expect(Number(sample.ui?.debugProjectionRate)).toBeLessThanOrEqual(4);
    expect(Number(sample.ui?.totalPublishRate)).toBeLessThanOrEqual(6);
  }
});
