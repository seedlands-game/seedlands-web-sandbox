import { expect, test, type Page } from '@playwright/test';
import type { HarnessApi } from '../../../src/app/game-harness';
import { lockPointer, startHarnessWorld, waitForSnapshot } from '../../../tests/e2e/support/harness';

type CostRecord = { index: number; ms: number };
type FrameRecord = {
  at: number;
  tick: number;
  debtMs: number;
  player: number[];
  meshQueue: number;
  uploadQueue: number;
};
type Sample = { frames: FrameRecord[]; costs: CostRecord[]; droppedCostSamples: number };
type SamplingWindow = Window & { __loopSample?: Promise<Sample>; __loopSampleStart?: number };
const current = (page: Page) => page.evaluate(() => (window.__seedlandsHarness as unknown as HarnessApi).snapshot());
const quantile = (values: number[], q: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * q) - 1]!;

test.use({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });

for (const configuration of [
  { name: 'A1', general: 1 },
  { name: 'A2', general: 1 },
  { name: 'B', general: 2 },
] as const) {
  test(`同机Medium自然路线${configuration.name}：帧与真实物理成本`, async ({ page, browser }, testInfo) => {
    test.setTimeout(90_000);
    await startHarnessWorld(page, 'independent-loop-natural-performance', `&generalWorkers=${configuration.general}`);
    await waitForSnapshot(
      page,
      (value) =>
        value.renderedChunks > 0 &&
        value.generationQueue === 0 &&
        value.meshingQueue === 0 &&
        value.performance.uploadQueueDepth === 0,
    );
    const before = await current(page);
    expect(before.quality).toBe('medium');
    expect(before.gameplay.creatureCount + before.gameplay.npcCount).toBeGreaterThanOrEqual(3);
    expect(before.authority.physicsCost?.count).toBeGreaterThan(0);
    const environment = await page.evaluate(() => {
      const canvas = document.querySelector('canvas')!;
      return {
        viewport: [innerWidth, innerHeight],
        dpr: devicePixelRatio,
        internal: [canvas.width, canvas.height],
        userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency,
      };
    });
    expect(environment.viewport).toEqual([1920, 1080]);
    expect(environment.dpr).toBe(2);
    // 保留现有Medium的0.88比例，任何内部降分辨率都必须被发现。
    expect(environment.internal[0]).toBeGreaterThanOrEqual(1920 * 2 * 0.88 - 2);
    expect(environment.internal[1]).toBeGreaterThanOrEqual(1080 * 2 * 0.88 - 2);
    await page.bringToFront();
    await lockPointer(page);
    await page.evaluate(() => {
      const harness = window.__seedlandsHarness as unknown as HarnessApi;
      const startedAt = performance.now();
      let lastCostCount = harness.snapshot().authority.physicsCost!.count;
      const sample: Sample = { frames: [], costs: [], droppedCostSamples: 0 };
      (window as SamplingWindow).__loopSampleStart = startedAt;
      (window as SamplingWindow).__loopSample = new Promise((resolve) => {
        const capture = () => {
          const now = performance.now(),
            value = harness.snapshot();
          sample.frames.push({
            at: now,
            tick: value.authority.physicsTick,
            debtMs: value.authority.physicsDebtMs,
            player: [...value.serverPlayerPosition],
            meshQueue: value.meshingQueue,
            uploadQueue: value.performance.uploadQueueDepth,
          });
          const cost = value.authority.physicsCost;
          if (cost && cost.count > lastCostCount) {
            const firstIndex = cost.count - cost.samplesMs.length;
            sample.droppedCostSamples += Math.max(0, firstIndex - lastCostCount);
            for (let index = Math.max(firstIndex, lastCostCount); index < cost.count; index++)
              sample.costs.push({ index, ms: cost.samplesMs[index - firstIndex]! });
            lastCostCount = cost.count;
          }
          if (now - startedAt >= 30_000) resolve(sample);
          else requestAnimationFrame(capture);
        };
        requestAnimationFrame(capture);
      });
    });
    try {
      await page.keyboard.down('Space');
      for (const [index, key] of ['KeyW', 'KeyD', 'KeyS'].entries()) {
        await page.keyboard.down(key);
        await page.waitForFunction(
          (milliseconds) => performance.now() - (window as SamplingWindow).__loopSampleStart! >= milliseconds,
          (index + 1) * 10_000,
        );
        await page.keyboard.up(key);
      }
    } finally {
      for (const key of ['Space', 'KeyW', 'KeyD', 'KeyS']) await page.keyboard.up(key);
    }
    const sample = await page.evaluate(async () => await (window as SamplingWindow).__loopSample!);
    const after = await current(page);
    const frames = sample.frames.slice(1).map((frame, index) => frame.at - sample.frames[index]!.at);
    const costs = sample.costs.map((value) => value.ms);
    const summary = {
      configuration,
      sourceSha: process.env.SEEDLANDS_E2E_SOURCE_SHA ?? 'UNSPECIFIED',
      browser: browser.version(),
      environment,
      frame: {
        count: frames.length,
        p50Ms: quantile(frames, 0.5),
        p95Ms: quantile(frames, 0.95),
        p99Ms: quantile(frames, 0.99),
        maxMs: Math.max(...frames),
      },
      physics: {
        count: costs.length,
        p50Ms: quantile(costs, 0.5),
        p95Ms: quantile(costs, 0.95),
        p99Ms: quantile(costs, 0.99),
        maxMs: Math.max(...costs),
        maxDebtMs: Math.max(...sample.frames.map((value) => value.debtMs)),
      },
      droppedCostSamples: sample.droppedCostSamples,
      before,
      after,
    };
    await testInfo.attach('loop-performance-summary', {
      body: JSON.stringify(summary, null, 2),
      contentType: 'application/json',
    });
    await testInfo.attach('loop-performance-raw', { body: JSON.stringify(sample), contentType: 'application/json' });
    await testInfo.attach('natural-route-final', { body: await page.screenshot(), contentType: 'image/png' });
    expect(sample.frames.at(-1)!.at - sample.frames[0]!.at).toBeGreaterThanOrEqual(29_900);
    expect(costs.length).toBeGreaterThan(1000);
    expect(sample.droppedCostSamples).toBe(0);
    expect(summary.frame.p95Ms).toBeLessThanOrEqual(20);
    expect(summary.physics.p95Ms).toBeLessThanOrEqual(4);
  });
}
