import type { Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import type { HarnessApi } from '../../../src/app/game-harness';
import { lockPointer, waitForSnapshot } from '../../../tests/e2e/support/harness';
import { RawCdp, targetRole, type ProfileCapture, type TargetInfo, withTimeout } from './combined-profiler';

export type CombinedVariant = 'A' | 'A_PRIME' | 'B';

// 每一对变体在十个 block 中各先出现五次；三个位置也尽量均衡。
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

type HarnessSnapshot = ReturnType<HarnessApi['snapshot']>;
type FramePhysicsSample = {
  frameMs: number[];
  physicsMs: number[];
  hiddenFrames: number;
  unfocusedFrames: number;
  missedPhysicsSamples: number;
};

type CombinedWindow = Window & {
  __adoptionSample?: Promise<FramePhysicsSample>;
  __adoptionStartedAt?: number;
};

export type AccelerationInspection = {
  role: string;
  url: string;
  diagnostic: '__seedlandsRust' | '__seedlandsWasm' | 'NONE';
  selected: string[];
  status: 'off' | 'ready' | 'fallback' | 'UNKNOWN';
  reason: string | null;
  artifactSha256: string | null;
  memory: null | { failed: boolean; bufferBytes: number | null };
};

export const harnessSnapshot = (page: Page): Promise<HarnessSnapshot | null> =>
  page.evaluate(() => (window.__seedlandsHarness as HarnessApi | undefined)?.snapshot() ?? null);

export async function clearOrigin(page: Page, origin: string): Promise<void> {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
  } finally {
    await session.detach();
  }
}

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
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.locator('#quality').selectOption('medium');
  await page.locator('#seed').fill(seed);
  const startedAt = await page.evaluate(() => performance.now());
  await page.getByRole('button', { name: '进入世界', exact: true }).click();
  await page.locator('#start-card').waitFor({ state: 'hidden', timeout: 30_000 });
  await page.locator('#debug').waitFor({ state: 'visible', timeout: 30_000 });
  await waitForSnapshot(
    page,
    (value) =>
      value.loadedChunks > 0 &&
      value.renderedChunks > 0 &&
      value.generationQueue === 0 &&
      value.meshingQueue === 0 &&
      value.deferredRemeshes === 0 &&
      value.performance.uploadQueueDepth === 0,
  );
  return (await page.evaluate(() => performance.now())) - startedAt;
}

async function beginNaturalSample(page: Page, milliseconds: number): Promise<void> {
  await page.evaluate((duration) => {
    const target = window as CombinedWindow;
    const startedAt = performance.now();
    target.__adoptionStartedAt = startedAt;
    target.__adoptionSample = new Promise((resolve) => {
      let previousFrameAt = startedAt;
      let previousPhysicsCount = window.__seedlandsHarness?.snapshot().authority.physicsCost?.count ?? 0;
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
        const costs = window.__seedlandsHarness?.snapshot().authority.physicsCost;
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

export async function runNaturalInput(
  page: Page,
  warmupMs: number,
  sampleMs: number,
  startProfile: () => Promise<void>,
): Promise<
  FramePhysicsSample & { before: HarnessSnapshot | null; after: HarnessSnapshot | null; checkpoints: object[] }
> {
  await page.bringToFront();
  await lockPointer(page);
  await page.keyboard.down('KeyW');
  await waitVisibleMilliseconds(page, warmupMs);
  await page.keyboard.up('KeyW');
  const before = await harnessSnapshot(page);
  await startProfile();
  await beginNaturalSample(page, sampleMs);
  const checkpoints: object[] = [];
  try {
    let elapsedFraction = 0;
    for (const step of NATURAL_INPUT_PLAN) {
      await page.keyboard.down(step.key);
      elapsedFraction += step.fraction;
      await page.waitForFunction(
        (elapsed) => performance.now() - (window as CombinedWindow).__adoptionStartedAt! >= elapsed,
        elapsedFraction * sampleMs,
        { timeout: sampleMs + 10_000 },
      );
      await page.keyboard.up(step.key);
      checkpoints.push({ key: step.key, snapshot: await harnessSnapshot(page) });
    }
  } finally {
    for (const step of NATURAL_INPUT_PLAN) await page.keyboard.up(step.key);
  }
  const sample = await page.evaluate(async () => await (window as CombinedWindow).__adoptionSample!);
  return { before, after: await harnessSnapshot(page), checkpoints, ...sample };
}

export function naturalMotionErrors(
  before: HarnessSnapshot | null,
  after: HarnessSnapshot | null,
  checkpoints: readonly object[],
): string[] {
  if (!before || !after) return ['真实输入轨迹缺少前后 Harness snapshot。'];
  const snapshots = checkpoints
    .map((entry) => (entry as { snapshot?: HarnessSnapshot | null }).snapshot)
    .filter((entry): entry is HarnessSnapshot => Boolean(entry));
  const displacement = snapshots.reduce((maximum, snapshot) => {
    const dx = snapshot.player[0] - before.player[0];
    const dz = snapshot.player[2] - before.player[2];
    return Math.max(maximum, Math.hypot(dx, dz));
  }, 0);
  const errors: string[] = [];
  if (displacement < 0.25) errors.push(`30 秒真实键盘窗口最大水平位移仅 ${displacement.toFixed(3)}。`);
  if (after.authority.physicsTick <= before.authority.physicsTick)
    errors.push('真实输入窗口内 Authority physicsTick 未推进。');
  return errors;
}

export async function prepareEditVisibleFeedback(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const harness = window.__seedlandsHarness as HarnessApi;
    if (!harness.beginFluidFeedbackSample || !harness.getFluidCell) throw new Error('编辑至可见 Harness 契约不可用。');
    harness.setTimePaused(false);
    await harness.movePlayerTo(0.5, 60.6, 5.5);
    harness.setView(0, -28);
    await harness.fillWorld({ from: [-3, 57, -2], to: [4, 63, 8], voxel: 0 });
    await harness.fillWorld({ from: [-3, 56, -2], to: [4, 56, 8], voxel: 3 });
    await harness.fillWorld({ from: [-1, 57, -1], to: [1, 57, -1], voxel: 3 });
    await harness.fillWorld({ from: [-1, 57, 1], to: [1, 57, 1], voxel: 3 });
    await harness.setVoxelAt(-1, 57, 0, 3);
    await harness.setVoxelAt(1, 57, 0, 3);
    await harness.setVoxelAt(2, 57, 0, 3);
    await harness.setVoxelAt(0, 57, 0, 8);
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

async function oneEditVisibleFeedback(page: Page): Promise<object> {
  return page.evaluate(async () => {
    const harness = window.__seedlandsHarness as HarnessApi;
    const before = harness.snapshot().fluidFeedback.count;
    harness.beginFluidFeedbackSample!({ x: 1, y: 57, z: 0, radius: 1 });
    await harness.setVoxelAt(1, 57, 0, 0);
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('编辑至可见样本超过 15 秒。')), 15_000);
      const check = () => {
        if (harness.snapshot().fluidFeedback.count > before) {
          clearTimeout(timeout);
          resolve();
        } else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
    const sample = harness.snapshot().fluidFeedback.samples.at(-1);
    if (!sample) throw new Error('编辑至可见 tracker 未返回分段样本。');
    await harness.setVoxelAt(1, 57, 0, 3);
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('编辑至可见清理超过 15 秒。')), 15_000);
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
    return sample;
  });
}

export async function runEditVisibleFeedback(page: Page, warmups: number, measured: number): Promise<object[]> {
  await prepareEditVisibleFeedback(page);
  for (let index = 0; index < warmups; index += 1) await oneEditVisibleFeedback(page);
  const samples: object[] = [];
  for (let index = 0; index < measured; index += 1) samples.push(await oneEditVisibleFeedback(page));
  return samples;
}

export async function inspectAccelerationWorkers(debugPort: string, origin: string): Promise<AccelerationInspection[]> {
  const response = await withTimeout(
    fetch(`http://127.0.0.1:${debugPort}/json/list`),
    5_000,
    '读取加速诊断 target 超过 5 秒。',
  );
  if (!response.ok) throw new Error(`CDP target list returned ${response.status}.`);
  const targets = (await response.json()) as TargetInfo[];
  const inspections: AccelerationInspection[] = [];
  for (const target of targets) {
    if (target.type !== 'worker' || !target.webSocketDebuggerUrl || !target.url.startsWith(origin)) continue;
    const client = await RawCdp.connect(target.webSocketDebuggerUrl);
    try {
      const evaluation = await withTimeout(
        client.send<{
          result: { value?: Omit<AccelerationInspection, 'role' | 'url'> };
          exceptionDetails?: { text?: string };
        }>('Runtime.evaluate', {
          expression: `(() => {
            const rust = self.__seedlandsRust;
            const wasm = self.__seedlandsWasm;
            const state = rust ?? wasm;
            if (!state) return { diagnostic: 'NONE', selected: [], status: 'UNKNOWN', reason: null, artifactSha256:null, memory: null };
            const memory = state.memory;
            return {
              diagnostic: rust ? '__seedlandsRust' : '__seedlandsWasm',
              selected: Array.isArray(state.selected) ? [...state.selected] : [],
              status: typeof state.status === 'string' ? state.status : 'UNKNOWN',
              reason: typeof state.reason === 'string' ? state.reason : null,
              artifactSha256: typeof state.artifactSha256 === 'string' ? state.artifactSha256 : null,
              memory: memory ? {
                failed: Boolean(memory.failed),
                bufferBytes: memory.memory?.buffer instanceof ArrayBuffer ? memory.memory.buffer.byteLength : null,
              } : null,
            };
          })()`,
          returnByValue: true,
        }),
        5_000,
        '读取 Worker 加速诊断超过 5 秒。',
      );
      if (evaluation.exceptionDetails || !evaluation.result.value)
        throw new Error(evaluation.exceptionDetails?.text ?? 'Worker 加速诊断没有返回值。');
      inspections.push({ role: targetRole(target), url: target.url, ...evaluation.result.value });
    } finally {
      client.close();
    }
  }
  return inspections.sort((left, right) => left.role.localeCompare(right.role) || left.url.localeCompare(right.url));
}

export function accelerationErrors(
  variant: CombinedVariant,
  inspections: readonly AccelerationInspection[],
  selectedRust: readonly string[],
  expectedArtifactHash: string,
): string[] {
  const errors: string[] = [];
  for (const role of ['general', 'fluid']) {
    const state = inspections.find((s) => s.role === role);
    if (!state || state.diagnostic === 'NONE') errors.push(`${variant} ${role} 缺少加速诊断`);
    const expected =
      variant === 'B'
        ? selectedRust
            .filter((n) => (role === 'fluid' ? n === 'w07' : ['w02', 'w03', 'w04', 'w05', 'w06'].includes(n)))
            .sort()
        : [];
    if (state && [...state.selected].sort().join(',') !== expected.join(','))
      errors.push(`${variant} ${role} 选择映射不符`);
  }
  const diagnosed = inspections.filter((inspection) => inspection.diagnostic !== 'NONE');
  if (inspections.some((inspection) => inspection.status === 'fallback')) errors.push('检测到加速 fallback。');
  const shouldRunRust = variant === 'B' && selectedRust.length > 0;
  if (!shouldRunRust) {
    for (const state of diagnosed)
      if (state.status !== 'off' || state.selected.length || state.memory !== null)
        errors.push(`${variant} ${state.role} 未保持加速关闭。`);
    return errors;
  }
  const observed = [...new Set(diagnosed.flatMap((state) => state.selected))].sort();
  if (observed.join(',') !== [...selectedRust].sort().join(','))
    errors.push(`B 实际 selected=${observed.join(',')}，请求=${[...selectedRust].sort().join(',')}。`);
  for (const state of diagnosed.filter((inspection) => inspection.selected.length)) {
    if (state.artifactSha256 !== expectedArtifactHash)
      errors.push(`B ${state.role} 实际产物hash不符：${state.artifactSha256}`);
    if (state.status !== 'ready') errors.push(`B ${state.role} status=${state.status}。`);
    if (!state.memory) errors.push(`B ${state.role} 缺少 Wasm memory。`);
    else if (state.memory.failed) errors.push(`B ${state.role} memory.failed=true。`);
  }
  return errors;
}

export function activeCpu(captures: readonly ProfileCapture[]): { totalMs: number; roles: Record<string, number> } {
  const roles: Record<string, number> = {};
  let totalMicroseconds = 0;
  for (const capture of captures) {
    const nodes = new Map(capture.profile.nodes.map((node) => [node.id, node]));
    let roleMicroseconds = 0;
    for (let index = 0; index < (capture.profile.samples?.length ?? 0); index += 1) {
      const node = nodes.get(capture.profile.samples![index]!);
      if (!node || node.callFrame.functionName === '(idle)') continue;
      roleMicroseconds += capture.profile.timeDeltas?.[index] ?? 0;
    }
    roles[capture.role] = (roles[capture.role] ?? 0) + roleMicroseconds / 1_000;
    totalMicroseconds += roleMicroseconds;
  }
  return { totalMs: totalMicroseconds / 1_000, roles };
}

export function memoryEvidence(captures: readonly ProfileCapture[]) {
  const supported = captures.filter((capture) => capture.heapUsage !== 'UNSUPPORTED');
  return {
    heap:
      supported.length === captures.length
        ? {
            status: 'COLLECTED',
            semantics: 'Runtime.getHeapUsage 在 CPU profile 结束时的各 isolate 快照；不是峰值。',
            byRole: Object.fromEntries(supported.map((capture) => [capture.role, capture.heapUsage])),
            totalUsedBytes: supported.reduce(
              (sum, capture) => sum + (capture.heapUsage === 'UNSUPPORTED' ? 0 : capture.heapUsage.usedSize),
              0,
            ),
          }
        : { status: 'UNSUPPORTED', supportedRoles: supported.map((capture) => capture.role) },
    rss: { status: 'NOT_COLLECTED', reason: '当前 CDP target 协议未提供可归因且口径一致的进程 RSS。' },
    gc: { status: 'NOT_COLLECTED', reason: '本 runner 未启用会改变负载或缺少跨 isolate 完整性的 GC instrumentation。' },
  };
}

export async function collectEnvironment(page: Page): Promise<object> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    return {
      viewport: [innerWidth, innerHeight],
      dpr: devicePixelRatio,
      internalCanvas: canvas ? [canvas.width, canvas.height] : null,
      visibilityState: document.visibilityState,
      focused: document.hasFocus(),
      hardwareConcurrency: navigator.hardwareConcurrency,
      userAgent: navigator.userAgent,
      screen: { width: screen.width, height: screen.height, colorDepth: screen.colorDepth },
    };
  });
}

export async function collectResourceManifest(page: Page, workerUrls: string[] = []): Promise<object[]> {
  return page.evaluate(async (workerUrls) => {
    const urls = [location.href, ...workerUrls, ...performance.getEntriesByType('resource').map((entry) => entry.name)];
    const scripts = [...new Set(urls)].filter((url) => url.startsWith(location.origin) && url.endsWith('.js'));
    const wasmUrls = new Set<string>();
    for (const script of scripts) {
      const source = await (await fetch(script, { cache: 'force-cache' })).text();
      for (const match of source.matchAll(/["']([^"']+\.wasm)["']/g)) wasmUrls.add(new URL(match[1]!, script).href);
    }
    const unique = [...new Set([...urls, ...wasmUrls].filter((url) => url.startsWith(location.origin)))];
    const hexadecimal = (bytes: Uint8Array) => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const resources = [];
    for (const url of unique) {
      const response = await fetch(url, { cache: 'force-cache' });
      // 浏览器自动探测的缺省图标不属于程序产物；其他资源失败仍阻止准出。
      if (response.status === 404 && new URL(url).pathname === '/favicon.ico') continue;
      if (!response.ok) throw new Error(`资源返回 ${response.status}: ${url}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      resources.push({
        url: new URL(url).pathname,
        bytes: bytes.byteLength,
        sha256: hexadecimal(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))),
        contentType: response.headers.get('content-type'),
      });
    }
    return resources.sort((left, right) => left.url.localeCompare(right.url));
  }, workerUrls);
}

export function buildHash(manifest: readonly object[]): string {
  const canonical = manifest
    .map((entry) => {
      const resource = entry as { url: string; bytes: number; sha256: string };
      return `${resource.url}\0${resource.bytes}\0${resource.sha256}`;
    })
    .sort()
    .join('\n');
  return createHash('sha256').update(canonical).digest('hex');
}
