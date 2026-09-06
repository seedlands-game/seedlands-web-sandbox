import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';
import type { HarnessApi } from '../../../src/app/game-harness';
import { startHarnessWorld } from '../../../tests/e2e/support/harness';

const TARGETS = [
  [-24, -12],
  [-15, -12],
  [-6, -12],
  [3, -12],
  [12, -12],
  [-24, -20],
  [-15, -20],
  [-6, -20],
  [3, -20],
  [12, -20],
  [-24, -28],
  [-15, -28],
  [-6, -28],
  [3, -28],
  [12, -28],
  [-24, -36],
  [-15, -36],
  [-6, -36],
  [3, -36],
  [12, -36],
] as const;
const TARGET_FLUID_SAMPLES = TARGETS.length;
const FIRST_SAMPLE_DIAGNOSTIC = process.env.SEEDLANDS_AUTHORITY_LOAD_FIRST_SAMPLE === '1';
const EXPECTED_STREAMED_CHUNKS = 50;
const SCENARIO_SOURCE = {
  seed: 'authority-controlled-load',
  actorSpawns: 16,
  worldItemSpawns: 64,
  frontierSourceCells: 1_024,
  targetFluidSamples: TARGET_FLUID_SAMPLES,
} as const;
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
  return page.evaluate(async (targets) => {
    const harness = window.__seedlandsHarness as unknown as HarnessApi;
    const actorIds: string[] = [];
    const worldItemIds: string[] = [];
    harness.setTimePaused(true);
    await harness.fillWorld({ from: [-14, 49, -11], to: [14, 56, 3], voxel: 0 });
    await harness.fillWorld({ from: [-14, 48, -11], to: [14, 48, 3], voxel: 3 });
    // Harness 坐标是相机/眼睛位置；50.6 对应脚底 y=49，避免嵌入 y=48 的地板。
    await harness.movePlayerTo(0, 50.6, 0);
    for (const [x, z] of targets) {
      await harness.fillWorld({ from: [x - 2, 48, z - 2], to: [x + 2, 49, z + 2], voxel: 3 });
      await harness.setVoxelAt(x, 49, z, 0);
      await harness.setVoxelAt(x + 1, 49, z, 0);
    }
    await harness.fillWorld({ from: [15, 49, 15], to: [48, 52, 48], voxel: 0 });
    await harness.fillWorld({ from: [15, 48, 15], to: [48, 48, 48], voxel: 3 });
    await harness.fillWorld({ from: [15, 49, 15], to: [15, 49, 48], voxel: 3 });
    await harness.fillWorld({ from: [48, 49, 15], to: [48, 49, 48], voxel: 3 });
    await harness.fillWorld({ from: [16, 49, 15], to: [47, 49, 15], voxel: 3 });
    await harness.fillWorld({ from: [16, 49, 48], to: [47, 49, 48], voxel: 3 });
    // 静态几何先全部提交；实体最后生成，避免准备期的数十次远端编辑让自主角色走出近场。
    for (let index = 0; index < 16; index += 1) {
      const result = await harness.executeGameplayCommand({
        type: 'spawn-actor',
        id: `load-actor-${index}`,
        // 固定负载角色只需要持续参加权威物理；统一 grazer，避免混合 night-stalker 触发持续逃跑。
        archetype: 'grazer',
        position: [1 + (index % 8), 49, -2 - Math.floor(index / 8) * 3],
      });
      if (!result.success) throw new Error(result.error.message);
      actorIds.push(`load-actor-${index}`);
    }
    for (let index = 0; index < 64; index += 1) {
      const result = await harness.executeGameplayCommand({
        type: 'spawn-world-item',
        itemId: 'stone-block',
        count: 1,
        position: [-12 + (index % 8), 49.4, -2 - Math.floor(index / 8)],
      });
      if (!result.success) throw new Error(result.error.message);
      const entityId = (result.data as { entity?: { id?: unknown } } | undefined)?.entity?.id;
      if (typeof entityId !== 'string') throw new Error('Spawned load item did not return an entity id.');
      worldItemIds.push(entityId);
    }
    return { actorIds, worldItemIds };
  }, TARGETS);
}

async function activateAuthorityFluidLoad(page: Page) {
  await page.evaluate(async () => {
    const harness = window.__seedlandsHarness as unknown as HarnessApi;
    harness.setTimePaused(false);
    // 32×32 个源水格经生产 editBatch 激活真实权威 frontier；不写诊断计数。
    await harness.fillWorld({ from: [16, 49, 16], to: [47, 49, 47], voxel: 8 });
  });
}

async function sampleTargetFluid(page: Page, testInfo: TestInfo, generalWorkers: 1 | 2, index: number) {
  const [x, z] = TARGETS[index]!;
  const targetBefore = await page.evaluate(
    ({ x, z }) => {
      const harness = window.__seedlandsHarness as unknown as HarnessApi;
      harness.setView((Math.atan2(-x, -z) * 180) / Math.PI, -8);
      return {
        voxel: harness.getVoxelAt?.(x, 49, z) ?? null,
        fluid: harness.getFluidCell?.(x, 49, z) ?? null,
        chunkRevision: harness.getChunkRevision?.(Math.floor(x / 32), 1, Math.floor(z / 32)) ?? null,
        containment: [
          [x - 2, z],
          [x + 2, z],
          [x, z - 2],
          [x, z + 2],
        ].map(([wallX, wallZ]) => ({
          x: wallX,
          y: 49,
          z: wallZ,
          voxel: harness.getVoxelAt?.(wallX, 49, wallZ) ?? null,
        })),
        bottom: [x, x + 1].map((bottomX) => ({
          x: bottomX,
          y: 48,
          z,
          voxel: harness.getVoxelAt?.(bottomX, 48, z) ?? null,
        })),
      };
    },
    { x, z },
  );
  expect(targetBefore.voxel).toBe(0);
  expect(targetBefore.fluid).toBeNull();
  expect(targetBefore.containment.map(({ voxel }) => voxel)).toEqual([3, 3, 3, 3]);
  expect(targetBefore.bottom.map(({ voxel }) => voxel)).toEqual([3, 3]);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const before = await snapshot(page);
  try {
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
  } finally {
    const evidence = await page.evaluate(
      ({ x, z, feedbackIndex }) => {
        const harness = window.__seedlandsHarness as unknown as HarnessApi;
        const current = harness.snapshot();
        const targetChunkKey = `${Math.floor(x / 32)},${Math.floor(49 / 32)},${Math.floor(z / 32)}`;
        const targetTraceId = current.fluidFeedback.samples[feedbackIndex]?.traceId;
        return {
          target: { x, y: 49, z, targetChunkKey },
          targetCells: [-1, 0, 1].flatMap((offsetZ) =>
            [-1, 0, 1].map((offsetX) => ({
              x: x + offsetX,
              y: 49,
              z: z + offsetZ,
              voxel: harness.getVoxelAt?.(x + offsetX, 49, z + offsetZ) ?? null,
              fluid: harness.getFluidCell?.(x + offsetX, 49, z + offsetZ) ?? null,
            })),
          ),
          containment: [
            [x - 2, z],
            [x + 2, z],
            [x, z - 2],
            [x, z + 2],
          ].map(([wallX, wallZ]) => ({
            x: wallX,
            y: 49,
            z: wallZ,
            voxel: harness.getVoxelAt?.(wallX, 49, wallZ) ?? null,
            fluid: harness.getFluidCell?.(wallX, 49, wallZ) ?? null,
          })),
          bottom: [x, x + 1].map((bottomX) => ({
            x: bottomX,
            y: 48,
            z,
            voxel: harness.getVoxelAt?.(bottomX, 48, z) ?? null,
            fluid: harness.getFluidCell?.(bottomX, 48, z) ?? null,
          })),
          snapshot: {
            loadedChunks: current.loadedChunks,
            renderedChunks: current.renderedChunks,
            generationQueue: current.generationQueue,
            meshingQueue: current.meshingQueue,
            deferredRemeshes: current.deferredRemeshes,
            uploadQueueDepth: current.performance.uploadQueueDepth,
            structuralEventCount: current.structuralEventCount,
            remeshSchedulingCount: current.remeshSchedulingCount,
            worldRevision: current.worldRevision,
            targetChunkRevision: harness.getChunkRevision?.(Math.floor(x / 32), 1, Math.floor(z / 32)) ?? null,
            authorityFluid: current.authority.fluid,
            fluidFeedback: current.fluidFeedback,
            compute: current.compute,
          },
          targetChunkTrace: harness
            .exportPerformanceTrace()
            .traceEvents.filter((event) => event.name === targetChunkKey || event.args?.traceId === targetTraceId)
            .slice(-64),
        };
      },
      { x, z, feedbackIndex: before.fluidFeedback.count },
    );
    await testInfo.attach(`authority-fluid-target-${generalWorkers}-${index}`, {
      body: JSON.stringify(
        {
          index,
          expectedFeedbackCount: before.fluidFeedback.count + 1,
          targetBefore,
          before: {
            fluidFeedback: before.fluidFeedback,
            authorityFluid: before.authority.fluid,
            structuralEventCount: before.structuralEventCount,
            remeshSchedulingCount: before.remeshSchedulingCount,
          },
          after: evidence,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  }
}

async function runConfiguration(
  browser: Browser,
  testInfo: TestInfo,
  generalWorkers: 1 | 2,
  targetFluidSamples: number = TARGET_FLUID_SAMPLES,
) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  try {
    await startHarnessWorld(page, SCENARIO_SOURCE.seed, `&generalWorkers=${generalWorkers}`);
    const scenarioId = await page.evaluate(() =>
      (window.__seedlandsHarness as unknown as HarnessApi).beginPerformanceScenario('authority-controlled-load'),
    );
    const spawned = await establishAuthorityLoad(page);
    const ready = await expect
      .poll(
        async () => {
          const current = await snapshot(page);
          return {
            loadedChunks: current.loadedChunks,
            generationQueue: current.generationQueue,
            meshingQueue: current.meshingQueue,
            deferredRemeshes: current.deferredRemeshes,
            uploadQueueDepth: current.performance.uploadQueueDepth,
            presentedEntities: current.gameplay.presentedEntityCount,
          };
        },
        { timeout: 30_000 },
      )
      .toMatchObject({
        loadedChunks: EXPECTED_STREAMED_CHUNKS,
        generationQueue: 0,
        meshingQueue: 0,
        deferredRemeshes: 0,
        uploadQueueDepth: 0,
        presentedEntities: 84,
      });
    void ready;
    const prepared = await snapshot(page);
    const spawnedBodies = await page.evaluate(({ actorIds, worldItemIds }) => {
      const harness = window.__seedlandsHarness as unknown as HarnessApi;
      const player = harness.snapshot().serverPlayerPosition;
      const inspect = (id: string) => ({ id, body: harness.authorityBody(id) });
      const nearPlayer = ({ body }: ReturnType<typeof inspect>) =>
        body !== null &&
        (body.position[0] - player[0]) ** 2 +
          (body.position[1] - player[1]) ** 2 +
          (body.position[2] - player[2]) ** 2 <=
          32 ** 2;
      const actors = actorIds.map(inspect);
      const worldItems = worldItemIds.map(inspect);
      return {
        actors,
        worldItems,
        nearActorIds: actors.filter(nearPlayer).map(({ id }) => id),
        nearWorldItemIds: worldItems.filter(nearPlayer).map(({ id }) => id),
      };
    }, spawned);
    await testInfo.attach(`authority-load-ready-general-${generalWorkers}`, {
      body: JSON.stringify({ snapshot: prepared, spawnedBodies }, null, 2),
      contentType: 'application/json',
    });
    expect(spawnedBodies.actors).toHaveLength(SCENARIO_SOURCE.actorSpawns);
    expect(spawnedBodies.worldItems).toHaveLength(SCENARIO_SOURCE.worldItemSpawns);
    expect(spawnedBodies.nearActorIds).toHaveLength(SCENARIO_SOURCE.actorSpawns);
    expect(spawnedBodies.nearWorldItemIds).toHaveLength(SCENARIO_SOURCE.worldItemSpawns);
    expect(prepared.renderedChunks).toBeGreaterThanOrEqual(25);
    expect(prepared.triangles).toBeGreaterThan(1_000);
    expect(prepared.gameplay.activeActorCount).toBeGreaterThanOrEqual(16);
    expect(prepared.gameplay.worldItemCount).toBeGreaterThanOrEqual(64);
    expect(prepared.authority.bodies.actors).toBeGreaterThanOrEqual(16);
    expect(prepared.authority.bodies.worldItems).toBeGreaterThanOrEqual(64);
    expect(prepared.authority.bodies.nearPlayer).toBeGreaterThanOrEqual(80);
    await startFrameSampling(page);
    await activateAuthorityFluidLoad(page);
    await expect
      .poll(async () => (await snapshot(page)).authority.fluid.pendingCellCount, { timeout: 10_000 })
      .toBeGreaterThanOrEqual(1_024);
    const loaded = await snapshot(page);
    await testInfo.attach(`authority-load-setup-general-${generalWorkers}`, {
      body: JSON.stringify(loaded, null, 2),
      contentType: 'application/json',
    });
    for (let index = 0; index < targetFluidSamples; index += 1)
      await sampleTargetFluid(page, testInfo, generalWorkers, index);
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
    const physicsCosts = final.authority.physicsCost?.samplesMs ?? [];
    const result = {
      sourceSha: process.env.SEEDLANDS_E2E_SOURCE_SHA ?? 'UNSPECIFIED',
      scenarioSource: { ...SCENARIO_SOURCE, targetFluidSamples },
      browser: browser.version(),
      generalWorkers,
      totalComputeSlots: 1 + generalWorkers,
      scenarioId,
      quality: final.quality,
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
      meshVisibleAfterPostrender: final.performance.visibleAfterPostrender,
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

test('单个近场流体反馈诊断保留完整提交与网格链', async ({ browser }, testInfo) => {
  test.skip(!FIRST_SAMPLE_DIAGNOSTIC, '仅在显式单样本诊断时运行。');
  test.setTimeout(120_000);
  const result = await runConfiguration(browser, testInfo, 1, 1);
  expect(result.fluidFeedback.count).toBe(1);
  expect(result.fluidFeedback.p95Ms).toBeLessThanOrEqual(100);
});

test('同机受控负载比较二槽与三槽计算池，不预设扩池收益', async ({ browser }, testInfo) => {
  test.skip(FIRST_SAMPLE_DIAGNOSTIC, '单样本诊断不重复执行完整 20 样本对照。');
  test.setTimeout(300_000);
  const twoSlots = await runConfiguration(browser, testInfo, 1);
  const threeSlots = await runConfiguration(browser, testInfo, 2);
  await testInfo.attach('authority-load-pool-comparison', {
    body: JSON.stringify({ twoSlots, threeSlots }, null, 2),
    contentType: 'application/json',
  });
  expect(threeSlots.scenarioSource).toEqual(twoSlots.scenarioSource);
  for (const result of [twoSlots, threeSlots]) {
    expect(result.environment.viewport).toEqual([1920, 1080]);
    expect(result.environment.dpr).toBe(2);
    expect(result.environment.internal[0]).toBeGreaterThanOrEqual(1920 * 2 * 0.88 - 2);
    expect(result.environment.internal[1]).toBeGreaterThanOrEqual(1080 * 2 * 0.88 - 2);
    expect(result.quality).toBe('medium');
    expect(result.compute.workerCount).toBe(result.totalComputeSlots);
    expect(result.compute.maxQueued).toBeGreaterThan(0);
    expect(result.compute.maxQueuedBytes).toBeGreaterThan(0);
    expect(result.compute.workerTaskDuration.fluid.count).toBeGreaterThan(0);
    expect(result.compute.workerTaskDuration.general.count).toBeGreaterThan(0);
    expect(result.load.authorityBodies.actors).toBeGreaterThanOrEqual(SCENARIO_SOURCE.actorSpawns);
    expect(result.load.authorityBodies.worldItems).toBeGreaterThanOrEqual(SCENARIO_SOURCE.worldItemSpawns);
    expect(result.load.authorityBodies.nearPlayer).toBeGreaterThanOrEqual(
      SCENARIO_SOURCE.actorSpawns + SCENARIO_SOURCE.worldItemSpawns,
    );
    expect(result.fluidFeedback.count).toBe(TARGET_FLUID_SAMPLES);
    expect(result.fluidFeedback.p95Ms).toBeLessThanOrEqual(100);
    expect(result.meshVisible.count).toBeGreaterThan(0);
    expect(result.meshVisibleAfterPostrender).toBe(true);
    expect(result.observedQueuePeaks.generation + result.observedQueuePeaks.meshing).toBeGreaterThan(0);
  }
});
