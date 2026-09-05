import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';
import type { HarnessApi } from '../../../src/app/game-harness';
import { startHarnessWorld } from '../../../tests/e2e/support/harness';

const TARGET_FLUID_SAMPLES = 20;
type LoadFrame = {
  at: number;
  debtMs: number;
  generationQueue: number;
  meshingQueue: number;
  uploadQueue: number;
  computeQueued: number;
  computeQueuedBytes: number;
  fluidPending: number;
};
type LoadSamplingWindow = Window & { __authorityLoadFrames?: LoadFrame[]; __authorityLoadSampling?: boolean };

const percentile = (values: readonly number[], quantile: number) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
};

const snapshot = (page: Page) => page.evaluate(() => (window.__seedlandsHarness as unknown as HarnessApi).snapshot());

const startFrameSampling = (page: Page) =>
  page.evaluate(() => {
    const target = window as LoadSamplingWindow;
    target.__authorityLoadFrames = [];
    target.__authorityLoadSampling = true;
    const capture = () => {
      if (!target.__authorityLoadSampling) return;
      const value = (window.__seedlandsHarness as unknown as HarnessApi).snapshot();
      target.__authorityLoadFrames!.push({
        at: performance.now(),
        debtMs: value.authority.physicsDebtMs,
        generationQueue: value.generationQueue,
        meshingQueue: value.meshingQueue,
        uploadQueue: value.performance.uploadQueueDepth,
        computeQueued: value.compute.queued,
        computeQueuedBytes: value.compute.queuedBytes,
        fluidPending: value.authority.fluid.pendingCellCount,
      });
      requestAnimationFrame(capture);
    };
    requestAnimationFrame(capture);
  });

const stopFrameSampling = (page: Page) =>
  page.evaluate(() => {
    const target = window as LoadSamplingWindow;
    target.__authorityLoadSampling = false;
    return target.__authorityLoadFrames ?? [];
  });

async function establishAuthorityLoad(page: Page) {
  await page.evaluate(async () => {
    const harness = window.__seedlandsHarness as unknown as HarnessApi;
    await harness.fillWorld({ from: [-20, 49, -20], to: [52, 56, 20], voxel: 0 });
    await harness.fillWorld({ from: [-20, 48, -20], to: [52, 48, 20], voxel: 3 });
    await harness.movePlayerTo(0, 49, 0);
    for (let index = 0; index < 16; index += 1) {
      const result = await harness.executeGameplayCommand({
        type: 'spawn-actor',
        id: `load-actor-${index}`,
        archetype: (['grazer', 'night-stalker', 'settler'] as const)[index % 3]!,
        position: [-7 + (index % 8) * 2, 49, -7 + Math.floor(index / 8) * 3],
      });
      if (!result.success) throw new Error(result.error.message);
    }
    for (let index = 0; index < 64; index += 1) {
      const result = await harness.executeGameplayCommand({
        type: 'spawn-world-item',
        itemId: 'stone-block',
        count: 1,
        position: [-15 + (index % 8), 49.4, -12 + Math.floor(index / 8)],
      });
      if (!result.success) throw new Error(result.error.message);
    }
    await harness.fillWorld({ from: [19, 48, -17], to: [52, 48, 16], voxel: 3 });
    await harness.fillWorld({ from: [19, 49, -17], to: [19, 49, 16], voxel: 3 });
    await harness.fillWorld({ from: [52, 49, -17], to: [52, 49, 16], voxel: 3 });
    await harness.fillWorld({ from: [20, 49, -17], to: [51, 49, -17], voxel: 3 });
    await harness.fillWorld({ from: [20, 49, 16], to: [51, 49, 16], voxel: 3 });
    // 32×32 个源水格经生产 editBatch 激活真实权威 frontier；不写诊断计数。
    await harness.fillWorld({ from: [20, 49, -16], to: [51, 49, 15], voxel: 8 });
  });
}

async function sampleTargetFluid(page: Page, index: number) {
  const x = -18 + (index % 10) * 4;
  const z = 10 + Math.floor(index / 10) * 4;
  await page.evaluate(
    async ({ x, z }) => {
      const harness = window.__seedlandsHarness as unknown as HarnessApi;
      await harness.fillWorld({ from: [x - 1, 49, z - 1], to: [x + 1, 49, z + 1], voxel: 3 });
      await harness.setVoxelAt(x, 49, z, 0);
      await harness.setVoxelAt(x + 1, 49, z, 0);
    },
    { x, z },
  );
  const before = await snapshot(page);
  await page.evaluate(
    async ({ x, z }) => {
      const harness = window.__seedlandsHarness as unknown as HarnessApi;
      harness.beginFluidFeedbackSample?.({ x, y: 49, z, radius: 1 });
      await harness.setVoxelAt(x, 49, z, 8);
    },
    { x, z },
  );
  await expect
    .poll(async () => (await snapshot(page)).fluidFeedback.count, { timeout: 15_000 })
    .toBe(before.fluidFeedback.count + 1);
}

async function runConfiguration(browser: Browser, testInfo: TestInfo, generalWorkers: 1 | 2) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  try {
    await startHarnessWorld(page, `authority-controlled-load-${generalWorkers}`, `&generalWorkers=${generalWorkers}`);
    await establishAuthorityLoad(page);
    await expect
      .poll(async () => (await snapshot(page)).authority.fluid.pendingCellCount, { timeout: 10_000 })
      .toBeGreaterThanOrEqual(1_024);
    const loaded = await snapshot(page);
    expect(loaded.gameplay.activeActorCount).toBeGreaterThanOrEqual(16);
    expect(loaded.gameplay.worldItemCount).toBeGreaterThanOrEqual(64);
    expect(loaded.authority.bodies.actors).toBeGreaterThanOrEqual(16);
    expect(loaded.authority.bodies.worldItems).toBeGreaterThanOrEqual(64);
    expect(loaded.authority.bodies.nearPlayer).toBeGreaterThanOrEqual(80);
    const scenarioId = await page.evaluate(() =>
      (window.__seedlandsHarness as unknown as HarnessApi).beginPerformanceScenario('authority-controlled-load'),
    );
    await startFrameSampling(page);
    for (let index = 0; index < TARGET_FLUID_SAMPLES; index += 1) await sampleTargetFluid(page, index);
    await expect
      .poll(async () => (await snapshot(page)).performance.completedChunkTraces, { timeout: 15_000 })
      .toBeGreaterThan(0);
    const frames = await stopFrameSampling(page);
    const final = await snapshot(page);
    const environment = await page.evaluate(() => {
      const canvas = document.querySelector('canvas')!;
      const memory = (
        performance as Performance & {
          memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
        }
      ).memory;
      return {
        viewport: [innerWidth, innerHeight],
        dpr: devicePixelRatio,
        internal: [canvas.width, canvas.height],
        userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency,
        memory: memory
          ? {
              status: 'available' as const,
              usedJSHeapSize: memory.usedJSHeapSize,
              totalJSHeapSize: memory.totalJSHeapSize,
              jsHeapSizeLimit: memory.jsHeapSizeLimit,
            }
          : { status: 'unavailable' as const },
      };
    });
    expect(environment.viewport).toEqual([1920, 1080]);
    expect(environment.dpr).toBe(2);
    expect(environment.internal[0]).toBeGreaterThanOrEqual(1920 * 2 * 0.88 - 2);
    expect(environment.internal[1]).toBeGreaterThanOrEqual(1080 * 2 * 0.88 - 2);
    expect(final.quality).toBe('medium');
    expect(final.compute.workerCount).toBe(1 + generalWorkers);
    expect(final.compute.maxQueued).toBeGreaterThan(0);
    expect(final.compute.maxQueuedBytes).toBeGreaterThan(0);
    expect(final.compute.workerTaskDuration.fluid.count).toBeGreaterThan(0);
    expect(final.compute.workerTaskDuration.general.count).toBeGreaterThan(0);
    expect(final.fluidFeedback.count).toBe(TARGET_FLUID_SAMPLES);
    expect(final.fluidFeedback.p95Ms).toBeLessThanOrEqual(100);
    expect(final.performance.completedChunkTraces).toBeGreaterThan(0);
    expect(final.performance.visibleAfterPostrender).toBe(true);
    expect(Math.max(...frames.map((frame) => frame.generationQueue + frame.meshingQueue))).toBeGreaterThan(0);
    const physicsCosts = final.authority.physicsCost?.samplesMs ?? [];
    const result = {
      sourceSha: process.env.SEEDLANDS_E2E_SOURCE_SHA ?? 'UNSPECIFIED',
      browser: browser.version(),
      generalWorkers,
      totalComputeSlots: 1 + generalWorkers,
      scenarioId,
      environment,
      load: {
        gameplay: final.gameplay,
        authorityBodies: final.authority.bodies,
        fluid: final.authority.fluid,
      },
      frame: final.performance.frame,
      physics: {
        count: final.authority.physicsCost?.count ?? 0,
        p50Ms: percentile(physicsCosts, 0.5),
        p95Ms: percentile(physicsCosts, 0.95),
        p99Ms: percentile(physicsCosts, 0.99),
        maxMs: physicsCosts.length ? Math.max(...physicsCosts) : 0,
        maxDebtMs: Math.max(final.authority.physicsDebtMs, ...frames.map((frame) => frame.debtMs)),
      },
      fluidFeedback: final.fluidFeedback,
      meshVisible: final.performance.chunkVisible,
      compute: final.compute,
      observedQueuePeaks: {
        generation: Math.max(0, ...frames.map((frame) => frame.generationQueue)),
        meshing: Math.max(0, ...frames.map((frame) => frame.meshingQueue)),
        upload: Math.max(0, ...frames.map((frame) => frame.uploadQueue)),
        computeTasks: Math.max(0, ...frames.map((frame) => frame.computeQueued)),
        computeBytes: Math.max(0, ...frames.map((frame) => frame.computeQueuedBytes)),
        fluidPending: Math.max(0, ...frames.map((frame) => frame.fluidPending)),
      },
    };
    await testInfo.attach(`authority-load-general-${generalWorkers}`, {
      body: JSON.stringify(result, null, 2),
      contentType: 'application/json',
    });
    return result;
  } finally {
    await context.close();
  }
}

test('同机受控负载比较二槽与三槽计算池，不预设扩池收益', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const twoSlots = await runConfiguration(browser, testInfo, 1);
  const threeSlots = await runConfiguration(browser, testInfo, 2);
  await testInfo.attach('authority-load-pool-comparison', {
    body: JSON.stringify({ twoSlots, threeSlots }, null, 2),
    contentType: 'application/json',
  });
});
