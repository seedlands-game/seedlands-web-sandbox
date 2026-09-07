import { expect, test, type Browser, type Page } from '@playwright/test';
import { snapshot, startHarnessWorld, waitForSnapshot, type HarnessSnapshot } from '../support/harness';
import { writeBrowserBenchmarkResult } from '../support/result';

type ProfileName = 'typescriptFallback' | 'defaultOptimized';
type Sample = {
  initialWorldReadyMs: number;
  frameP95Ms: number;
  frameP99Ms: number;
  nonIdleTaskDurationMs: number;
  editP95Ms: number;
  editP99Ms: number;
  experiments: HarnessSnapshot['experiments'];
  hardwareConcurrency: number;
};
type ProfileResult = {
  status: 'PASS' | 'FALLBACK_NOT_BASELINE';
  requested: { renderer: 'webgl2'; wasm: boolean; simd: boolean };
  metrics: Record<string, number>;
  samples: Sample[];
};

const profileQueries: Record<ProfileName, string> = {
  typescriptFallback: '&renderer=webgl2&wasm=off&simd=off',
  defaultOptimized: '&renderer=webgl2&wasm=on&simd=on',
};

const percentile = (values: readonly number[], ratio: number) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))] ?? 0;
};

const metric = (metrics: Array<{ name: string; value: number }>, name: string) =>
  metrics.find((entry) => entry.name === name)?.value ?? 0;

const waitForMutationCount = (page: Page, count: number) =>
  page.waitForFunction((target) => (window.__seedlandsHarness?.snapshot().mutationCount ?? -1) >= target, count);

async function sampleProfile(browser: Browser, profile: ProfileName, index: number): Promise<Sample> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  try {
    const startedAt = performance.now();
    await startHarnessWorld(page, `seedlands-${profile}-${index}`, profileQueries[profile]);
    const initialWorldReadyMs = performance.now() - startedAt;
    await page.evaluate(() => window.__seedlandsHarness?.beginPerformanceScenario('harness-dual-baseline'));
    const beforeTask = await cdp.send('Performance.getMetrics');
    await page.waitForTimeout(30_000);
    const afterTask = await cdp.send('Performance.getMetrics');
    const stable = await waitForSnapshot(page, (current) => current.performance.frame.count > 30);
    const editSamples: number[] = [];
    let mutationCount = stable.mutationCount;
    for (let edit = 0; edit < 10; edit += 1) {
      const startedEdit = performance.now();
      await page.evaluate(
        async ({ x, y, z, voxel }) => {
          await window.__seedlandsHarness?.setVoxelAt(x, y, z, voxel);
          await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        },
        { x: edit % 5, y: 34, z: Math.floor(edit / 5), voxel: edit % 2 ? 1 : 4 },
      );
      mutationCount += 1;
      await waitForMutationCount(page, mutationCount);
      editSamples.push(performance.now() - startedEdit);
    }
    const current = await snapshot(page);
    expect(current).not.toBeNull();
    return {
      initialWorldReadyMs,
      frameP95Ms: stable.performance.frame.p95Ms,
      frameP99Ms: stable.performance.frame.p99Ms,
      nonIdleTaskDurationMs:
        (metric(afterTask.metrics, 'TaskDuration') - metric(beforeTask.metrics, 'TaskDuration')) * 1000,
      editP95Ms: percentile(editSamples, 0.95),
      editP99Ms: percentile(editSamples, 0.99),
      experiments: current!.experiments,
      hardwareConcurrency: await page.evaluate(() => navigator.hardwareConcurrency),
    };
  } finally {
    await context.close();
  }
}

const profileMatches = (name: ProfileName, sample: Sample) => {
  const requested = sample.experiments.requested;
  if (requested.renderer !== 'webgl2' || sample.experiments.renderer?.effectiveRenderer !== 'webgl2') return false;
  const general = sample.experiments.workers.filter(({ lane }) => lane === 'general');
  return name === 'typescriptFallback'
    ? requested.wasm === false && general.length > 0 && general.every(({ status }) => status === 'off')
    : requested.wasm === true &&
        requested.simd === true &&
        general.length > 0 &&
        general.every(({ status, effectiveArtifact }) => status === 'matched' && effectiveArtifact === 'simd');
};

test('采集优化 TS 兜底与默认全优化两个环境内浏览器基线', async ({ browser }) => {
  test.setTimeout(240_000);
  const profiles = {} as Record<ProfileName, ProfileResult>;
  for (const profile of Object.keys(profileQueries) as ProfileName[]) {
    const samples: Sample[] = [];
    for (let index = 0; index < 3; index += 1) samples.push(await sampleProfile(browser, profile, index));
    const comparable = samples.every((sample) => profileMatches(profile, sample));
    profiles[profile] = {
      status: comparable ? 'PASS' : 'FALLBACK_NOT_BASELINE',
      requested:
        profile === 'typescriptFallback'
          ? { renderer: 'webgl2', wasm: false, simd: false }
          : { renderer: 'webgl2', wasm: true, simd: true },
      metrics: {
        initialWorldReadyMedianMs: percentile(
          samples.map(({ initialWorldReadyMs }) => initialWorldReadyMs),
          0.5,
        ),
        frameP95MedianMs: percentile(
          samples.map(({ frameP95Ms }) => frameP95Ms),
          0.5,
        ),
        frameP99MedianMs: percentile(
          samples.map(({ frameP99Ms }) => frameP99Ms),
          0.5,
        ),
        nonIdleTaskDurationMedianMs: percentile(
          samples.map(({ nonIdleTaskDurationMs }) => nonIdleTaskDurationMs),
          0.5,
        ),
        editP95MedianMs: percentile(
          samples.map(({ editP95Ms }) => editP95Ms),
          0.5,
        ),
        editP99MedianMs: percentile(
          samples.map(({ editP99Ms }) => editP99Ms),
          0.5,
        ),
      },
      samples,
    };
  }
  await writeBrowserBenchmarkResult({
    status: Object.values(profiles).every((profile) => profile.status === 'PASS') ? 'PASS' : 'FALLBACK_NOT_BASELINE',
    profiles,
  });
});
