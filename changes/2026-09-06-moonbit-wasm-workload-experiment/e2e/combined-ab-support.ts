import type { Page } from '@playwright/test';
import type { HarnessApi } from '../../../src/app/game-harness';
import { lockPointer, waitForSnapshot } from '../../../tests/e2e/support/harness';
import type { WasmWorkerInspection } from './combined-ab-cdp';
import { collectResourceManifest } from './p0-environment';

export type CombinedVariant = 'A' | 'A_PRIME' | 'B';

// 十个 block 中每一对变体的先后次序恰好各 5 次；A 与 B 的三个位置计数均为 3/4/3。
export const COMBINED_BLOCK_ORDERS: readonly (readonly CombinedVariant[])[] = [
  ['A', 'B', 'A_PRIME'],
  ['A_PRIME', 'B', 'A'],
  ['B', 'A', 'A_PRIME'],
  ['A_PRIME', 'A', 'B'],
  ['A', 'A_PRIME', 'B'],
  ['B', 'A_PRIME', 'A'],
  ['A', 'B', 'A_PRIME'],
  ['A_PRIME', 'B', 'A'],
  ['B', 'A', 'A_PRIME'],
  ['A_PRIME', 'A', 'B'],
] as const;

export const NATURAL_INPUT_PLAN = [
  { key: 'KeyW', fraction: 1 / 3 },
  { key: 'KeyD', fraction: 1 / 3 },
  { key: 'KeyS', fraction: 1 / 3 },
] as const;

type FramePhysicsSample = {
  frameMs: number[];
  physicsMs: number[];
  hiddenFrames: number;
  unfocusedFrames: number;
  missedPhysicsSamples: number;
};

type CombinedWindow = Window & {
  __p3Sample?: Promise<FramePhysicsSample>;
  __p3StartedAt?: number;
};

export const harnessSnapshot = (page: Page) =>
  page.evaluate(() => (window.__seedlandsHarness as HarnessApi | undefined)?.snapshot() ?? null);

const waitVisibleMilliseconds = (page: Page, milliseconds: number) =>
  page.evaluate(
    async (duration) =>
      new Promise<void>((resolve) => {
        const startedAt = performance.now();
        const next = (now: number) => {
          if (now - startedAt >= duration) resolve();
          else requestAnimationFrame(next);
        };
        requestAnimationFrame(next);
      }),
    milliseconds,
  );

export async function enterCombinedWorld(page: Page, url: string, seed: string): Promise<number> {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('#quality').selectOption('medium');
  await page.locator('#seed').fill(seed);
  const startedAt = await page.evaluate(() => performance.now());
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
  return (await page.evaluate(() => performance.now())) - startedAt;
}

async function beginNaturalSample(page: Page, milliseconds: number): Promise<void> {
  await page.evaluate((duration) => {
    const target = window as CombinedWindow;
    const startedAt = performance.now();
    target.__p3StartedAt = startedAt;
    target.__p3Sample = new Promise((resolve) => {
      let previousFrameAt = startedAt;
      let previousPhysicsCount =
        (window.__seedlandsHarness as HarnessApi | undefined)?.snapshot().authority.physicsCost?.count ?? 0;
      const result: FramePhysicsSample = {
        frameMs: [],
        physicsMs: [],
        hiddenFrames: 0,
        unfocusedFrames: 0,
        missedPhysicsSamples: 0,
      };
      const frame = (now: number) => {
        result.frameMs.push(now - previousFrameAt);
        if (document.hidden) result.hiddenFrames += 1;
        if (!document.hasFocus()) result.unfocusedFrames += 1;
        previousFrameAt = now;
        const costs = (window.__seedlandsHarness as HarnessApi | undefined)?.snapshot().authority.physicsCost;
        if (costs && costs.count > previousPhysicsCount) {
          const added = costs.count - previousPhysicsCount;
          const available = Math.min(added, costs.samplesMs.length);
          result.missedPhysicsSamples += Math.max(0, added - available);
          result.physicsMs.push(...costs.samplesMs.slice(-available));
          previousPhysicsCount = costs.count;
        }
        if (now - startedAt >= duration) resolve(result);
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }, milliseconds);
}

const finishNaturalSample = (page: Page): Promise<FramePhysicsSample> =>
  page.evaluate(async () => await (window as CombinedWindow).__p3Sample!);

export async function runNaturalInput(
  page: Page,
  warmupMs: number,
  sampleMs: number,
  startProfile: () => Promise<void>,
): Promise<{
  before: object | null;
  after: object | null;
  frameMs: number[];
  physicsMs: number[];
  hiddenFrames: number;
  unfocusedFrames: number;
  missedPhysicsSamples: number;
}> {
  await page.bringToFront();
  await lockPointer(page);
  await page.keyboard.down('KeyW');
  await waitVisibleMilliseconds(page, warmupMs);
  await page.keyboard.up('KeyW');
  const before = await harnessSnapshot(page);
  await startProfile();
  await beginNaturalSample(page, sampleMs);
  try {
    let elapsedFraction = 0;
    for (const step of NATURAL_INPUT_PLAN) {
      await page.keyboard.down(step.key);
      elapsedFraction += step.fraction;
      await page.waitForFunction(
        (elapsed) => performance.now() - (window as CombinedWindow).__p3StartedAt! >= elapsed,
        elapsedFraction * sampleMs,
      );
      await page.keyboard.up(step.key);
    }
  } finally {
    for (const step of NATURAL_INPUT_PLAN) await page.keyboard.up(step.key);
  }
  return { before, after: await harnessSnapshot(page), ...(await finishNaturalSample(page)) };
}

export async function prepareFluidFeedback(page: Page): Promise<void> {
  await page.evaluate(() => {
    const harness = window.__seedlandsHarness as HarnessApi;
    harness.setTimePaused(false);
    void harness.movePlayerTo(0.5, 60.6, 5.5);
    harness.setView(0, -28);
    for (let z = -2; z <= 8; z += 1)
      for (let x = -3; x <= 4; x += 1) {
        void harness.setVoxelAt(x, 56, z, 3);
        for (let y = 57; y <= 63; y += 1) void harness.setVoxelAt(x, y, z, 0);
      }
    for (let z = -1; z <= 1; z += 1)
      for (let x = -1; x <= 1; x += 1) if (x !== 0 || z !== 0) void harness.setVoxelAt(x, 57, z, 3);
    void harness.setVoxelAt(2, 57, 0, 3);
    void harness.setVoxelAt(0, 57, 0, 8);
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

async function oneFluidFeedback(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const harness = window.__seedlandsHarness as HarnessApi;
    if (!harness.beginFluidFeedbackSample || !harness.getFluidCell) throw new Error('流体可见反馈 Harness 不可用。');
    const before = harness.snapshot().fluidFeedback.count;
    harness.beginFluidFeedbackSample({ x: 1, y: 57, z: 0, radius: 1 });
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
      const timeout = window.setTimeout(() => reject(new Error('流体反馈清理超时。')), 15_000);
      const check = () => {
        const snapshot = harness.snapshot();
        if (
          harness.getFluidCell!(1, 57, 0) == null &&
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

export async function runFluidFeedback(page: Page, warmupTasks: number, measuredTasks: number): Promise<number[]> {
  await prepareFluidFeedback(page);
  for (let index = 0; index < warmupTasks; index += 1) await oneFluidFeedback(page);
  const samples: number[] = [];
  for (let index = 0; index < measuredTasks; index += 1) samples.push(await oneFluidFeedback(page));
  return samples;
}

export async function collectCombinedResourceManifest(page: Page): Promise<object[]> {
  const base = await collectResourceManifest(page);
  const wasm = await page.evaluate(async () => {
    const scripts = [...new Set(performance.getEntriesByType('resource').map((entry) => entry.name))].filter(
      (url) => url.startsWith(location.origin) && url.endsWith('.js'),
    );
    const wasmUrls = new Set<string>();
    for (const script of scripts) {
      const source = await (await fetch(script, { cache: 'force-cache' })).text();
      for (const match of source.matchAll(/["']([^"']+\.wasm)["']/g)) wasmUrls.add(new URL(match[1]!, script).href);
    }
    const hexadecimal = (bytes: Uint8Array) => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const resources = [];
    for (const url of wasmUrls) {
      const response = await fetch(url, { cache: 'force-cache' });
      if (!response.ok) throw new Error(`Wasm resource returned ${response.status}: ${url}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      resources.push({
        url: new URL(url).pathname,
        bytes: bytes.byteLength,
        sha256: hexadecimal(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))),
        contentType: response.headers.get('content-type'),
      });
    }
    return resources;
  });
  const byUrl = new Map([...base, ...wasm].map((entry) => [(entry as { url: string }).url, entry]));
  return [...byUrl.values()].sort((left, right) =>
    (left as { url: string }).url.localeCompare((right as { url: string }).url),
  );
}

export function validateWasmWorkers(
  variant: CombinedVariant,
  inspections: readonly WasmWorkerInspection[],
  requested: readonly string[],
): { errors: string[]; memoryBufferBytes: number } {
  const errors: string[] = [];
  const withDebug = inspections.filter((inspection) => inspection.debugFieldPresent);
  if (inspections.some((inspection) => inspection.status === 'fallback')) errors.push('检测到 Wasm fallback。');
  if (variant === 'A_PRIME') {
    if (!withDebug.length) errors.push('A′ 没有可验证的 __seedlandsWasm 诊断字段。');
    for (const state of withDebug)
      if (state.status !== 'off' || state.selected.length || state.memory !== null)
        errors.push(`A′ ${state.role} 未保持 off。`);
  }
  if (variant === 'B') {
    const observed = [...new Set(withDebug.flatMap((state) => state.selected))].sort();
    if (observed.join(',') !== [...requested].sort().join(','))
      errors.push(`B 实际 selected=${observed.join(',')}，请求=${[...requested].sort().join(',')}。`);
    for (const state of withDebug.filter((inspection) => inspection.selected.length)) {
      if (state.status !== 'ready') errors.push(`B ${state.role} status=${state.status}。`);
      if (!state.memory) errors.push(`B ${state.role} 缺少 Wasm memory。`);
      else if (state.memory.failed) errors.push(`B ${state.role} memory.failed=true。`);
    }
  }
  const memoryBufferBytes = withDebug.reduce((sum, state) => sum + (state.memory?.bufferBytes ?? 0), 0);
  if (memoryBufferBytes > 96 * 1024 * 1024) errors.push(`Wasm memory 合计 ${memoryBufferBytes} bytes 超过 96 MiB。`);
  return { errors, memoryBufferBytes };
}
