import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { gzip as gzipCallback } from 'node:zlib';
import { pairedBootstrap, percentile } from './ab-statistics';
import { inspectWasmWorkers } from './combined-ab-cdp';
import {
  COMBINED_BLOCK_ORDERS,
  collectCombinedResourceManifest,
  harnessSnapshot,
  NATURAL_INPUT_PLAN,
  runFluidFeedback,
  runNaturalInput,
  type CombinedVariant,
  validateWasmWorkers,
  enterCombinedWorld,
} from './combined-ab-support';
import { collectEnvironment } from './p0-environment';
import { BrowserProfiler, launchP0Chrome, type ProfileCapture } from './p0-profiler';

const gzip = promisify(gzipCallback);
const FROZEN_A_SHA = 'f2454937a4217d88420e1f21ac8ffda4e94847ea';
const FROZEN_A_ORIGIN = process.env.SEEDLANDS_P3_A_ORIGIN ?? 'http://127.0.0.1:4188/';
const SAMPLE_MS = 30_000;
const WARMUP_MS = 5_000;
const FLUID_WARMUP_TASKS = 5;
const FLUID_MEASURED_TASKS = 30;
const P3_EVIDENCE_PREFIX = 'changes/2026-09-06-moonbit-wasm-workload-experiment/evidence/p3-combined-';
const ALLOWED_KERNELS = new Set(['w02', 'w03', 'w04', 'w05', 'w06', 'w07', 'w10', 'w14', 'w15']);
const FROZEN_A_RUNTIME_HASHES = [
  '946bbc680552ecc831a5caa931fd40d984c3d59d425b89f889682c657975dc68',
  '5d3cad27e15c72174a2d00496627b1ff6343fecf6a65228770cd282ea56d04a2',
  '5f24065edffb13701d2204ebb3396d8e4618a477afe9e857db7afaf8808c0605',
  'f80bfdaa82d0155d0ccab8c79410f0696d851f655bfa7d4a6078a9b504b08ac8',
  'c5d227ce94ed194d73329ed7c43c2ff814fdc227e320ad91232d6ee157901edc',
  'dccedaff6fe10bbc3fe5c190ec033aa34160f5bd3d0f5535de6eb702ce7bfc10',
] as const;

type MetricName = 'readyMs' | 'activeCpuMs' | 'frameP95Ms' | 'physicsP95Ms' | 'fluidVisibleP95Ms';

type CombinedRun = {
  block: number;
  order: number;
  variant: CombinedVariant;
  sourceSha: string;
  url: string;
  startedAt: string;
  endedAt: string;
  status: 'valid' | 'invalid';
  invalidReasons: string[];
  browser: string;
  browserMode: 'headless-new';
  environment: object | null;
  workers: object | null;
  wasmWorkers: object[];
  wasmMemoryBufferBytes: number;
  metrics: Record<MetricName, number | null>;
  counts: {
    frame: number;
    physics: number;
    fluid: number;
    hiddenFrames: number;
    unfocusedFrames: number;
    missedPhysicsSamples: number;
  };
  trajectory: object;
};

const git = (...arguments_: string[]) =>
  execFileSync('git', arguments_, { cwd: resolve('.'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

async function workingTreeIdentity(): Promise<{ sourceSha: string; treeHash: string; untracked: string[] }> {
  const sourceSha = git('rev-parse', 'HEAD');
  const diff = execFileSync('git', ['diff', '--binary', 'HEAD', '--', '.', `:(exclude)${P3_EVIDENCE_PREFIX}*`], {
    cwd: resolve('.'),
    maxBuffer: 64 * 1024 * 1024,
  });
  const untracked = git('ls-files', '--others', '--exclude-standard')
    .split('\n')
    .filter((path) => path && !path.startsWith(P3_EVIDENCE_PREFIX))
    .sort();
  const hash = createHash('sha256').update(sourceSha).update('\0').update(diff);
  for (const path of untracked)
    hash
      .update('\0')
      .update(path)
      .update('\0')
      .update(await readFile(path));
  return { sourceSha, treeHash: hash.digest('hex'), untracked };
}

function parseSelection(): string[] {
  const selected = [...new Set((process.env.SEEDLANDS_WASM_SELECTED ?? '').split(',').filter(Boolean))].sort();
  if (!selected.length) throw new Error('SEEDLANDS_WASM_SELECTED 必须是 P2 冻结的非空正收益集合。');
  const invalid = selected.filter((name) => !ALLOWED_KERNELS.has(name));
  if (invalid.length) throw new Error(`未知 Wasm kernel：${invalid.join(',')}。`);
  return selected;
}

function runUrl(variant: CombinedVariant, currentBaseUrl: string, selected: readonly string[]): URL {
  const url = new URL(variant === 'A' ? FROZEN_A_ORIGIN : currentBaseUrl);
  url.searchParams.set('harness', '1');
  if (variant === 'A_PRIME') url.searchParams.set('wasm', 'off');
  if (variant === 'B') url.searchParams.set('wasm', selected.join(','));
  return url;
}

async function clearOrigin(page: Page, origin: string): Promise<void> {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
  } finally {
    await session.detach();
  }
}

function activeCpu(captures: readonly ProfileCapture[]): { totalMs: number; roles: Record<string, number> } {
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

function workerErrors(snapshot: Awaited<ReturnType<typeof harnessSnapshot>>, roles: readonly string[]): string[] {
  const errors: string[] = [];
  const expectedRoles = ['authority', 'fluid', 'general', 'logic', 'persistence'];
  if (!snapshot) return ['Harness snapshot 缺失。'];
  if (
    snapshot.workers.total !== 5 ||
    expectedRoles.some((role) => snapshot.workers[role as keyof typeof snapshot.workers] !== 1)
  )
    errors.push(`Harness Worker 预算改变：${JSON.stringify(snapshot.workers)}。`);
  if (roles.join(',') !== expectedRoles.join(',')) errors.push(`CDP Worker target 改变：${roles.join(',')}。`);
  return errors;
}

function metricStatistics(runs: readonly CombinedRun[]) {
  const result: Record<string, object> = {};
  for (const metric of ['readyMs', 'activeCpuMs', 'frameP95Ms', 'physicsP95Ms', 'fluidVisibleP95Ms'] as const) {
    const byVariant = (variant: CombinedVariant) =>
      Array.from(
        { length: 10 },
        (_, index) =>
          runs.find((run) => run.block === index + 1 && run.variant === variant && run.status === 'valid')?.metrics[
            metric
          ],
      );
    const a = byVariant('A');
    const aPrime = byVariant('A_PRIME');
    const b = byVariant('B');
    const complete = [...a, ...aPrime, ...b].every((value): value is number => typeof value === 'number');
    result[metric] = complete
      ? {
          unit: 'run',
          aVsAPrime: pairedBootstrap(a as number[], aPrime as number[]),
          aVsB: pairedBootstrap(a as number[], b as number[]),
        }
      : {
          status: 'INVALID_DUE_TO_RUN_FAILURE',
          unit: 'run',
          values: { A: a, A_PRIME: aPrime, B: b },
        };
  }
  return result;
}

function comparableResourceIdentity(manifest: readonly object[]): string {
  return manifest
    .filter((entry) => !(entry as { url?: string }).url?.endsWith('.wasm'))
    .map((entry) => {
      const resource = entry as { url?: string; bytes?: number; sha256?: string };
      return `${resource.url}:${resource.bytes}:${resource.sha256}`;
    })
    .sort()
    .join('|');
}

test('P3：headless A / A′ / B 十个平衡 block 的统一真实负载', async ({ baseURL }, testInfo) => {
  test.skip(process.env.SEEDLANDS_P3_COMBINED !== '1', 'P3 统一性能采样须显式启用。');
  test.setTimeout(3_600_000);
  if (!baseURL) throw new Error('Playwright baseURL 未配置。');
  const selected = parseSelection();
  if (new URL(baseURL).origin === new URL(FROZEN_A_ORIGIN).origin)
    throw new Error('A 与 A′/B 必须由不同 origin 的冻结产物服务。');
  const runId = (process.env.SEEDLANDS_P3_RUN_ID ?? new Date().toISOString()).replaceAll(/[^a-zA-Z0-9._-]/g, '-');
  const evidenceDirectory = new URL(`../evidence/p3-combined-${runId}/`, import.meta.url);
  await mkdir(evidenceDirectory, { recursive: false });
  const initialTree = await workingTreeIdentity();
  const native = await launchP0Chrome();
  const runs: CombinedRun[] = [];
  const rawManifest: Array<{
    path: string;
    bytes: number;
    sha256: string;
    status: 'valid' | 'invalid';
    block: number;
    variant: CombinedVariant;
  }> = [];
  const resourceManifests: Partial<Record<CombinedVariant, object[]>> = {};
  const controls = {
    blocks: 10,
    blockOrders: COMBINED_BLOCK_ORDERS,
    orderDesign: 'pairwise-order-balanced; A and B position counts 3/4/3; A_PRIME position counts 4/2/4',
    browserMode: 'headless-new',
    viewport: [1920, 1080],
    quality: 'medium',
    dpr: 1,
    workerBudget: 5,
    naturalWarmupMs: WARMUP_MS,
    naturalSampleMs: SAMPLE_MS,
    naturalInputPlan: NATURAL_INPUT_PLAN,
    fluidWarmupTasks: FLUID_WARMUP_TASKS,
    fluidMeasuredTasks: FLUID_MEASURED_TASKS,
    cachePolicy: '每次清空 origin storage；同一 Chrome 进程共享 HTTP 与编译缓存；首个样本不丢弃',
    bootstrapUnit: 'run',
    bootstrapIterations: 10_000,
    selected,
    frozenA: { sourceSha: FROZEN_A_SHA, origin: new URL(FROZEN_A_ORIGIN).origin },
    current: { sourceSha: initialTree.sourceSha, treeHash: initialTree.treeHash },
  };

  const persistCheckpoint = async (complete: boolean) =>
    writeFile(
      new URL(complete ? 'p3-combined-summary.json' : 'p3-combined-checkpoint.json', evidenceDirectory),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          phase: 'P3',
          runId,
          generatedAt: new Date().toISOString(),
          complete,
          controls,
          resourceManifests,
          rawManifest,
          runs,
          ...(complete ? { statistics: metricStatistics(runs) } : {}),
        },
        null,
        2,
      )}\n`,
    );

  try {
    const context = native.browser.contexts()[0];
    for (const initialPage of context.pages()) await initialPage.close();
    for (const [blockIndex, order] of COMBINED_BLOCK_ORDERS.entries()) {
      for (const [orderIndex, variant] of order.entries()) {
        const page = await context.newPage();
        await page.setViewportSize({ width: 1920, height: 1080 });
        const url = runUrl(variant, baseURL, selected);
        const invalidReasons: string[] = [];
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        const profiler = new BrowserProfiler(native.debugPort, url.origin);
        let profileStarted = false;
        let captures: ProfileCapture[] = [];
        let environment: object | null = null;
        let workers: object | null = null;
        let wasmWorkers: Awaited<ReturnType<typeof inspectWasmWorkers>> = [];
        let wasmMemoryBufferBytes = 0;
        let frameMs: number[] = [];
        let physicsMs: number[] = [];
        let fluidMs: number[] = [];
        let hiddenFrames = 0;
        let unfocusedFrames = 0;
        let missedPhysicsSamples = 0;
        let readyMs: number | null = null;
        let before: object | null = null;
        let after: object | null = null;
        const startedAt = new Date().toISOString();
        try {
          await clearOrigin(page, url.origin);
          readyMs = await enterCombinedWorld(page, url.href, `moonbit-p3-combined-${blockIndex + 1}`);
          const natural = await runNaturalInput(page, WARMUP_MS, SAMPLE_MS, async () => {
            profileStarted = true;
            await profiler.start();
          });
          ({ before, after, frameMs, physicsMs, hiddenFrames, unfocusedFrames, missedPhysicsSamples } = natural);
          captures = await profiler.stop();
          profileStarted = false;
          const profileRoles = [...new Set(captures.map((capture) => capture.role))].sort();
          if (profileRoles.join(',') !== 'authority,fluid,general,logic,main,persistence')
            invalidReasons.push(`CPU profile target 改变：${profileRoles.join(',')}。`);
          fluidMs = await runFluidFeedback(page, FLUID_WARMUP_TASKS, FLUID_MEASURED_TASKS);
          environment = await collectEnvironment(page);
          const finalSnapshot = await harnessSnapshot(page);
          workers = finalSnapshot?.workers ?? null;
          wasmWorkers = await inspectWasmWorkers(native.debugPort, url.origin);
          const wasmValidation = validateWasmWorkers(variant, wasmWorkers, selected);
          wasmMemoryBufferBytes = wasmValidation.memoryBufferBytes;
          invalidReasons.push(...wasmValidation.errors);
          const roles = wasmWorkers.map((worker) => worker.role).sort();
          invalidReasons.push(...workerErrors(finalSnapshot, roles));
          if (!resourceManifests[variant]) resourceManifests[variant] = await collectCombinedResourceManifest(page);
          const measuredEnvironment = environment as {
            viewport?: number[];
            dpr?: number;
            internalCanvas?: number[];
          };
          if (measuredEnvironment.viewport?.join(',') !== '1920,1080') invalidReasons.push('CSS viewport 改变。');
          if (measuredEnvironment.dpr !== 1) invalidReasons.push(`DPR=${measuredEnvironment.dpr ?? 'UNKNOWN'}。`);
          if (measuredEnvironment.internalCanvas?.join(',') !== '1689,950')
            invalidReasons.push(`内部 Canvas=${measuredEnvironment.internalCanvas?.join('x') ?? 'UNKNOWN'}。`);
          if (hiddenFrames || unfocusedFrames) invalidReasons.push('测量窗口发生隐藏或失焦。');
          if (missedPhysicsSamples) invalidReasons.push(`遗漏 ${missedPhysicsSamples} 个 physics sample。`);
          if (!frameMs.length || !physicsMs.length || fluidMs.length !== FLUID_MEASURED_TASKS)
            invalidReasons.push('预注册指标样本不完整。');
        } catch (error) {
          invalidReasons.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
          if (profileStarted) {
            captures = await profiler.stop().catch((stopError) => {
              invalidReasons.push(stopError instanceof Error ? stopError.message : String(stopError));
              return [];
            });
          }
        }
        invalidReasons.push(...pageErrors, ...profiler.errors);
        const cpu = activeCpu(captures);
        const run: CombinedRun = {
          block: blockIndex + 1,
          order: orderIndex + 1,
          variant,
          sourceSha: variant === 'A' ? FROZEN_A_SHA : initialTree.sourceSha,
          url: url.href,
          startedAt,
          endedAt: new Date().toISOString(),
          status: invalidReasons.length ? 'invalid' : 'valid',
          invalidReasons,
          browser: native.browser.version(),
          browserMode: 'headless-new',
          environment,
          workers,
          wasmWorkers,
          wasmMemoryBufferBytes,
          metrics: {
            readyMs,
            activeCpuMs: captures.length ? cpu.totalMs : null,
            frameP95Ms: frameMs.length ? percentile(frameMs, 0.95) : null,
            physicsP95Ms: physicsMs.length ? percentile(physicsMs, 0.95) : null,
            fluidVisibleP95Ms: fluidMs.length ? percentile(fluidMs, 0.95) : null,
          },
          counts: {
            frame: frameMs.length,
            physics: physicsMs.length,
            fluid: fluidMs.length,
            hiddenFrames,
            unfocusedFrames,
            missedPhysicsSamples,
          },
          trajectory: { seed: `moonbit-p3-combined-${blockIndex + 1}`, input: NATURAL_INPUT_PLAN, before, after },
        };
        const stem = `p3-block-${String(blockIndex + 1).padStart(2, '0')}-${variant.toLowerCase()}`;
        const rawBytes = await gzip(
          JSON.stringify({
            schemaVersion: 1,
            run,
            pageErrors,
            profilerErrors: profiler.errors,
            cpu,
            frameMs,
            physicsMs,
            fluidMs,
            captures,
          }),
          { level: 9 },
        );
        const rawPath = `${stem}-raw.json.gz`;
        await writeFile(new URL(rawPath, evidenceDirectory), rawBytes);
        rawManifest.push({
          path: rawPath,
          bytes: rawBytes.byteLength,
          sha256: createHash('sha256').update(rawBytes).digest('hex'),
          status: run.status,
          block: run.block,
          variant: run.variant,
        });
        await writeFile(new URL(`${stem}.json`, evidenceDirectory), `${JSON.stringify(run, null, 2)}\n`);
        runs.push(run);
        await persistCheckpoint(false);
        await page.close();
      }
    }
    const finalTree = await workingTreeIdentity();
    if (finalTree.sourceSha !== initialTree.sourceSha || finalTree.treeHash !== initialTree.treeHash) {
      const reason = `测量期间源码树改变：${initialTree.sourceSha}/${initialTree.treeHash} -> ${finalTree.sourceSha}/${finalTree.treeHash}`;
      for (const run of runs) {
        run.status = 'invalid';
        run.invalidReasons.push(reason);
      }
    }
    const aHashes = new Set(
      (resourceManifests.A ?? []).map((entry) => (entry as { sha256?: string }).sha256).filter(Boolean),
    );
    const missingFrozenHashes = FROZEN_A_RUNTIME_HASHES.filter((hash) => !aHashes.has(hash));
    if (missingFrozenHashes.length) {
      const reason = `A 资源不是冻结 f245493 产物，缺少 hash：${missingFrozenHashes.join(',')}`;
      for (const run of runs.filter((entry) => entry.variant === 'A')) {
        run.status = 'invalid';
        run.invalidReasons.push(reason);
      }
    }
    if (
      resourceManifests.A_PRIME &&
      resourceManifests.B &&
      comparableResourceIdentity(resourceManifests.A_PRIME) !== comparableResourceIdentity(resourceManifests.B)
    ) {
      const reason = 'A′ 与 B 的非 Wasm production 资源 identity 不同。';
      for (const run of runs.filter((entry) => entry.variant !== 'A')) {
        run.status = 'invalid';
        run.invalidReasons.push(reason);
      }
    }
    if (!resourceManifests.B?.some((entry) => (entry as { url?: string }).url?.endsWith('.wasm'))) {
      const reason = 'B 资源清单没有可追溯的 Wasm 文件 SHA-256。';
      for (const run of runs.filter((entry) => entry.variant === 'B')) {
        run.status = 'invalid';
        run.invalidReasons.push(reason);
      }
    }
    const currentUrls = (resourceManifests.A_PRIME ?? []).map((entry) => (entry as { url?: string }).url ?? '');
    if (
      currentUrls.some((url) => url.startsWith('/src/')) ||
      !currentUrls.some((url) => /\/assets\/index-.*\.js$/.test(url))
    ) {
      const reason = 'A′/B origin 不是可识别的 production build 产物。';
      for (const run of runs.filter((entry) => entry.variant !== 'A')) {
        run.status = 'invalid';
        run.invalidReasons.push(reason);
      }
    }
    for (const raw of rawManifest)
      raw.status = runs.find((run) => run.block === raw.block && run.variant === raw.variant)?.status ?? 'invalid';
    await persistCheckpoint(true);
    await testInfo.attach('p3-combined-summary', {
      body: await readFile(new URL('p3-combined-summary.json', evidenceDirectory)),
      contentType: 'application/json',
    });
    expect(runs, `证据目录：${relative(resolve('.'), evidenceDirectory.pathname)}`).toHaveLength(30);
    expect(runs.flatMap((run) => run.invalidReasons)).toEqual([]);
  } finally {
    await native.close();
  }
});
