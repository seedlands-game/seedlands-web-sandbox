import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import type { HarnessApi } from '../../../src/app/game-harness';
import { lockPointer, waitForSnapshot } from '../../../tests/e2e/support/harness';
import { collectEnvironment, collectResourceManifest } from './p0-environment';
import { analyseProfiles, BrowserProfiler, launchP0Chrome } from './p0-profiler';

const SOURCE_SHA = 'f2454937a4217d88420e1f21ac8ffda4e94847ea';
const SAMPLE_MS = Number(process.env.SEEDLANDS_P0_SAMPLE_MS ?? 30_000);
const WARMUP_MS = Number(process.env.SEEDLANDS_P0_WARMUP_MS ?? 5_000);
const EVENT_WARMUP = Number(process.env.SEEDLANDS_P0_EVENT_WARMUP ?? 20);
const EVENT_SAMPLES = Number(process.env.SEEDLANDS_P0_EVENT_SAMPLES ?? 30);
const EVIDENCE_DIRECTORY = new URL('../evidence/', import.meta.url);

type FrameSample = {
  frameMs: number[];
  hiddenFrames: number;
  unfocusedFrames: number;
};

type P0Window = Window & {
  __p0FrameSample?: Promise<FrameSample>;
  __p0FrameStartedAt?: number;
};

type WorkloadResult = {
  taskSamplesMs: number[];
  before: object | null;
  after: object | null;
  workload: object;
  frame?: FrameSample;
};

const percentile = (values: readonly number[], quantile: number): number | null => {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * quantile) - 1)] ?? null;
};

const harnessSnapshot = (page: Page) =>
  page.evaluate(() => (window.__seedlandsHarness as HarnessApi | undefined)?.snapshot() ?? null);

async function waitVisibleMilliseconds(page: Page, milliseconds: number): Promise<void> {
  await page.evaluate(
    async (duration) =>
      new Promise<void>((resolve) => {
        const startedAt = performance.now();
        const frame = (now: number) => {
          if (now - startedAt >= duration) resolve();
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
    milliseconds,
  );
}

async function beginFrameSample(page: Page, milliseconds: number): Promise<void> {
  await page.evaluate((duration) => {
    const target = window as P0Window;
    const startedAt = performance.now();
    target.__p0FrameStartedAt = startedAt;
    target.__p0FrameSample = new Promise((resolve) => {
      let previous = startedAt;
      const result: FrameSample = { frameMs: [], hiddenFrames: 0, unfocusedFrames: 0 };
      const frame = (now: number) => {
        result.frameMs.push(now - previous);
        if (document.hidden) result.hiddenFrames += 1;
        if (!document.hasFocus()) result.unfocusedFrames += 1;
        previous = now;
        if (now - startedAt >= duration) resolve(result);
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }, milliseconds);
}

const finishFrameSample = (page: Page): Promise<FrameSample> =>
  page.evaluate(async () => await (window as P0Window).__p0FrameSample!);

async function enterWorld(page: Page, seed: string): Promise<void> {
  await page.goto(new URL('./?harness=1', page.url()).href, { waitUntil: 'networkidle' });
  await page.locator('#quality').selectOption('medium');
  await page.locator('#seed').fill(seed);
  await page.getByRole('button', { name: '进入世界', exact: true }).click();
  await page.locator('#start-card').waitFor({ state: 'hidden' });
  await page.locator('#debug').waitFor({ state: 'visible', timeout: 15_000 });
  await waitForSnapshot(
    page,
    (value) =>
      value.loadedChunks > 0 &&
      value.renderedChunks > 0 &&
      value.generationQueue === 0 &&
      value.meshingQueue === 0 &&
      value.performance.uploadQueueDepth === 0,
  );
}

async function naturalWorkload(page: Page, startProfile: () => Promise<void>): Promise<WorkloadResult> {
  await enterWorld(page, 'moonbit-p0-natural');
  await page.bringToFront();
  await lockPointer(page);
  await page.keyboard.down('KeyW');
  await waitVisibleMilliseconds(page, WARMUP_MS);
  await page.keyboard.up('KeyW');
  const before = await harnessSnapshot(page);
  await startProfile();
  await beginFrameSample(page, SAMPLE_MS);
  try {
    for (const [index, key] of ['KeyW', 'KeyD', 'KeyS'].entries()) {
      await page.keyboard.down(key);
      await page.waitForFunction(
        (elapsed) => performance.now() - (window as P0Window).__p0FrameStartedAt! >= elapsed,
        ((index + 1) * SAMPLE_MS) / 3,
      );
      await page.keyboard.up(key);
    }
  } finally {
    for (const key of ['KeyW', 'KeyD', 'KeyS']) await page.keyboard.up(key);
  }
  const frame = await finishFrameSample(page);
  return {
    taskSamplesMs: [],
    before,
    after: await harnessSnapshot(page),
    workload: { kind: 'continuous-real-input', sampleMs: SAMPLE_MS },
    frame,
  };
}

async function loadingWorkload(page: Page, startProfile: () => Promise<void>): Promise<WorkloadResult> {
  await startProfile();
  const startedAt = performance.now();
  await page.locator('#quality').selectOption('medium');
  await page.locator('#seed').fill('moonbit-p0-loading');
  await page.getByRole('button', { name: '进入世界', exact: true }).click();
  await page.locator('#debug').waitFor({ state: 'visible', timeout: 15_000 });
  await waitForSnapshot(
    page,
    (value) =>
      value.renderedChunks > 0 &&
      value.generationQueue === 0 &&
      value.meshingQueue === 0 &&
      value.performance.uploadQueueDepth === 0,
  );
  const readyMs = performance.now() - startedAt;
  return {
    taskSamplesMs: [readyMs],
    before: null,
    after: await harnessSnapshot(page),
    workload: { kind: 'fresh-context-entry', readyMs, cachePolicy: 'fresh context; shared browser HTTP cache' },
  };
}

async function prepareFluid(page: Page): Promise<void> {
  await enterWorld(page, 'moonbit-p0-fluid');
  await page.evaluate(() => {
    const harness = window.__seedlandsHarness as HarnessApi;
    harness.setTimePaused(false);
    harness.movePlayerTo(0.5, 60.6, 5.5);
    harness.setView(0, -28);
    for (let z = -2; z <= 8; z += 1)
      for (let x = -3; x <= 4; x += 1) {
        harness.setVoxelAt(x, 56, z, 3);
        for (let y = 57; y <= 63; y += 1) harness.setVoxelAt(x, y, z, 0);
      }
    for (let z = -1; z <= 1; z += 1)
      for (let x = -1; x <= 1; x += 1) if (x !== 0 || z !== 0) harness.setVoxelAt(x, 57, z, 3);
    harness.setVoxelAt(2, 57, 0, 3);
    harness.setVoxelAt(0, 57, 0, 8);
  });
  await waitForSnapshot(
    page,
    (state) =>
      state.generationQueue === 0 &&
      state.meshingQueue === 0 &&
      state.deferredRemeshes === 0 &&
      state.performance.uploadQueueDepth === 0,
  );
}

async function oneFluidTask(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const harness = window.__seedlandsHarness as HarnessApi;
    const before = harness.snapshot().fluidFeedback.count;
    harness.beginFluidFeedbackSample?.();
    const startedAt = performance.now();
    await harness.setVoxelAt(1, 57, 0, 0);
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('流体反馈样本超时。')), 15_000);
      const check = () => {
        if (harness.snapshot().fluidFeedback.count > before) {
          clearTimeout(timeout);
          resolve();
        } else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
    const elapsed = performance.now() - startedAt;
    await harness.setVoxelAt(1, 57, 0, 3);
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('流体清理超时。')), 15_000);
      const check = () => {
        const snapshot = harness.snapshot();
        if (
          harness.getFluidCell?.(1, 57, 0) == null &&
          snapshot.generationQueue === 0 &&
          snapshot.meshingQueue === 0 &&
          snapshot.deferredRemeshes === 0 &&
          snapshot.performance.uploadQueueDepth === 0
        ) {
          clearTimeout(timeout);
          resolve();
        } else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
    return elapsed;
  });
}

async function fluidWorkload(page: Page, startProfile: () => Promise<void>): Promise<WorkloadResult> {
  await prepareFluid(page);
  for (let index = 0; index < EVENT_WARMUP; index += 1) await oneFluidTask(page);
  const before = await harnessSnapshot(page);
  await startProfile();
  const taskSamplesMs = [];
  for (let index = 0; index < EVENT_SAMPLES; index += 1) taskSamplesMs.push(await oneFluidTask(page));
  return {
    taskSamplesMs,
    before,
    after: await harnessSnapshot(page),
    workload: { kind: 'fluid-edit-to-visible', warmupTasks: EVENT_WARMUP, measuredTasks: EVENT_SAMPLES },
  };
}

async function aiWorkload(page: Page, startProfile: () => Promise<void>): Promise<WorkloadResult> {
  await enterWorld(page, 'moonbit-p0-ai');
  await page.evaluate(async () => {
    const harness = window.__seedlandsHarness as HarnessApi;
    harness.setTimePaused(false);
    await harness.fillWorld({ from: [-2, 48, -2], to: [18, 48, 18], voxel: 3 });
    for (let index = 0; index < 16; index += 1) {
      const result = await harness.executeGameplayCommand({
        type: 'spawn-actor',
        id: `p0-ai-${index}`,
        archetype: 'grazer',
        position: [1 + (index % 4) * 3, 49, 1 + Math.floor(index / 4) * 3],
      });
      if (!result.success) throw new Error(result.error.message);
    }
  });
  await waitVisibleMilliseconds(page, WARMUP_MS);
  const before = await harnessSnapshot(page);
  await startProfile();
  await beginFrameSample(page, SAMPLE_MS);
  const frame = await finishFrameSample(page);
  return {
    taskSamplesMs: [],
    before,
    after: await harnessSnapshot(page),
    workload: { kind: '16-actor-natural-ai', sampleMs: SAMPLE_MS },
    frame,
  };
}

async function oneSaveTask(page: Page, index: number): Promise<number> {
  return page.evaluate(async (taskIndex) => {
    const harness = window.__seedlandsHarness as HarnessApi;
    const x = 2 + (taskIndex % 10);
    const z = 2 + Math.floor(taskIndex / 10);
    const startedAt = performance.now();
    await harness.setVoxelAt(x, 50, z, taskIndex % 2 === 0 ? 2 : 3);
    await harness.flushSave();
    return performance.now() - startedAt;
  }, index);
}

async function saveWorkload(page: Page, startProfile: () => Promise<void>): Promise<WorkloadResult> {
  await enterWorld(page, 'moonbit-p0-save');
  for (let index = 0; index < EVENT_WARMUP; index += 1) await oneSaveTask(page, index);
  const before = await harnessSnapshot(page);
  await startProfile();
  const taskSamplesMs = [];
  for (let index = EVENT_WARMUP; index < EVENT_WARMUP + EVENT_SAMPLES; index += 1)
    taskSamplesMs.push(await oneSaveTask(page, index));
  return {
    taskSamplesMs,
    before,
    after: await harnessSnapshot(page),
    workload: { kind: 'edit-and-flush-save', warmupTasks: EVENT_WARMUP, measuredTasks: EVENT_SAMPLES },
  };
}

async function oneMapTask(page: Page, index: number): Promise<number> {
  const layers = ['elevation', 'biome', 'temperature', 'humidity', 'hydrology'];
  return page.evaluate(
    async ({ layer, taskIndex }) => {
      const select = document.querySelector<HTMLSelectElement>('#map-layer');
      const panel = document.querySelector<HTMLElement>('#macro-map-panel');
      if (!select || !panel) throw new Error('Macro 地图控件不可用。');
      const startedAt = performance.now();
      select.value = layer;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error(`地图任务 ${taskIndex} 超时。`)), 15_000);
        let observedSampling = false;
        const check = () => {
          observedSampling ||= panel.dataset.status === 'sampling';
          if (observedSampling && panel.dataset.status === 'ready') {
            clearTimeout(timeout);
            resolve();
          } else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      });
      return performance.now() - startedAt;
    },
    { layer: layers[index % layers.length]!, taskIndex: index },
  );
}

async function mapWorkload(page: Page, startProfile: () => Promise<void>): Promise<WorkloadResult> {
  await enterWorld(page, 'moonbit-p0-map');
  await page.getByRole('button', { name: 'Macro 地图' }).click();
  await expect(page.getByLabel('Macro 世界地图总览')).toHaveAttribute('data-status', 'ready', { timeout: 15_000 });
  for (let index = 1; index <= EVENT_WARMUP; index += 1) await oneMapTask(page, index);
  const before = await harnessSnapshot(page);
  await startProfile();
  const taskSamplesMs = [];
  for (let index = EVENT_WARMUP + 1; index <= EVENT_WARMUP + EVENT_SAMPLES; index += 1)
    taskSamplesMs.push(await oneMapTask(page, index));
  return {
    taskSamplesMs,
    before,
    after: await harnessSnapshot(page),
    workload: { kind: 'main-thread-map-layer-render', warmupTasks: EVENT_WARMUP, measuredTasks: EVENT_SAMPLES },
  };
}

const workloadRunners: Record<string, (page: Page, startProfile: () => Promise<void>) => Promise<WorkloadResult>> = {
  natural: naturalWorkload,
  loading: loadingWorkload,
  fluid: fluidWorkload,
  ai: aiWorkload,
  save: saveWorkload,
  map: mapWorkload,
};

test('P0：冻结 TypeScript 产物的六对 headless A/A 与全角色 CPU profile', async ({ baseURL }, testInfo) => {
  test.skip(process.env.SEEDLANDS_P0_PROFILE !== '1', 'P0 性能采样须显式启用。');
  test.setTimeout(1_200_000);
  if (!baseURL) throw new Error('Playwright baseURL 未配置。');
  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  const native = await launchP0Chrome();
  const runs = [];
  let resourceManifest: object[] | undefined;
  const selectedScenarios = process.env.SEEDLANDS_P0_SCENARIOS
    ? process.env.SEEDLANDS_P0_SCENARIOS.split(',')
    : Object.keys(workloadRunners);
  try {
    const defaultContext = native.browser.contexts()[0];
    for (const initialPage of defaultContext.pages()) await initialPage.close();
    for (const scenario of selectedScenarios) {
      for (const repetition of [1, 2] as const) {
        // Chrome 默认 Context 承担真实 Pointer Lock；其余负载使用全新隔离 Context。
        // 两次自然 A/A 使用不同页面与 seed，不复用一次运行内的游戏状态。
        const context =
          scenario === 'natural'
            ? defaultContext
            : await native.browser.newContext({
                viewport: { width: 1920, height: 1080 },
                deviceScaleFactor: 1,
              });
        const page = await context.newPage();
        await page.setViewportSize({ width: 1920, height: 1080 });
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(new URL('?harness=1', baseURL).href, { waitUntil: 'networkidle' });
        const storageSession = await context.newCDPSession(page);
        await storageSession.send('Storage.clearDataForOrigin', {
          origin: new URL(baseURL).origin,
          storageTypes: 'all',
        });
        await storageSession.detach();
        await page.bringToFront();
        await expect.poll(() => page.evaluate(() => document.hasFocus() && !document.hidden)).toBe(true);
        const profiler = new BrowserProfiler(native.debugPort, new URL(baseURL).origin);
        const startedAt = new Date().toISOString();
        let profileStarted = false;
        const result = await workloadRunners[scenario]!(page, async () => {
          if (profileStarted) throw new Error(`场景 ${scenario} 重复启动 profiler。`);
          profileStarted = true;
          await profiler.start();
        });
        expect(profileStarted).toBe(true);
        const captures = await profiler.stop();
        const endedAt = new Date().toISOString();
        const environment = await collectEnvironment(page);
        if (!resourceManifest) resourceManifest = await collectResourceManifest(page);
        const analysis = await analyseProfiles(new URL(baseURL).origin, scenario, captures);
        const run = {
          schemaVersion: 1,
          phase: 'P0',
          sourceSha: SOURCE_SHA,
          scenario,
          repetition,
          startedAt,
          endedAt,
          browser: native.browser.version(),
          headed: false,
          browserMode: 'headless-new',
          quality: 'medium',
          environment,
          errors,
          profilerErrors: profiler.errors,
          task: {
            ...result.workload,
            count: result.taskSamplesMs.length,
            p50Ms: percentile(result.taskSamplesMs, 0.5),
            p95Ms: percentile(result.taskSamplesMs, 0.95),
            p99Ms: percentile(result.taskSamplesMs, 0.99),
            maxMs: result.taskSamplesMs.length ? Math.max(...result.taskSamplesMs) : null,
            rawMs: result.taskSamplesMs,
          },
          frame: result.frame
            ? {
                count: result.frame.frameMs.length,
                p50Ms: percentile(result.frame.frameMs, 0.5),
                p95Ms: percentile(result.frame.frameMs, 0.95),
                p99Ms: percentile(result.frame.frameMs, 0.99),
                maxMs: Math.max(...result.frame.frameMs),
                hiddenFrames: result.frame.hiddenFrames,
                unfocusedFrames: result.frame.unfocusedFrames,
                rawMs: result.frame.frameMs,
              }
            : null,
          before: result.before,
          after: result.after,
          analysis,
        };
        const raw = {
          schemaVersion: 1,
          sourceSha: SOURCE_SHA,
          scenario,
          repetition,
          captures,
        };
        const stem = `p0-profile-${scenario}-a${repetition}`;
        await writeFile(new URL(`${stem}.json`, EVIDENCE_DIRECTORY), `${JSON.stringify(run, null, 2)}\n`);
        await writeFile(new URL(`${stem}-raw.cpuprofile.json`, EVIDENCE_DIRECTORY), `${JSON.stringify(raw)}\n`);
        await testInfo.attach(stem, { body: JSON.stringify(run, null, 2), contentType: 'application/json' });
        runs.push(run);
        expect(errors).toEqual([]);
        expect(profiler.errors).toEqual([]);
        expect((environment as { viewport: number[] }).viewport).toEqual([1920, 1080]);
        expect(captures.some((capture) => capture.role === 'main')).toBe(true);
        expect(captures.some((capture) => capture.role === 'authority')).toBe(true);
        if (context === defaultContext) await page.close();
        else await context.close();
      }
    }
    const summary = {
      schemaVersion: 1,
      phase: 'P0',
      sourceSha: SOURCE_SHA,
      browser: native.browser.version(),
      generatedAt: new Date().toISOString(),
      controls: {
        aaPairs: selectedScenarios.length,
        runs: selectedScenarios.length * 2,
        scenarios: selectedScenarios,
        headed: false,
        browserMode: 'headless-new',
        viewport: [1920, 1080],
        quality: 'medium',
        sampleMs: SAMPLE_MS,
        warmupMs: WARMUP_MS,
        eventWarmup: EVENT_WARMUP,
        eventSamples: EVENT_SAMPLES,
        workerBudget: 5,
      },
      resourceManifest,
      runs,
    };
    await writeFile(new URL('p0-aa-summary.json', EVIDENCE_DIRECTORY), `${JSON.stringify(summary, null, 2)}\n`);
    await testInfo.attach('p0-aa-summary', { body: JSON.stringify(summary, null, 2), contentType: 'application/json' });
  } finally {
    await native.close();
  }
});
