import { expect, test } from '@playwright/test';
import { expectedBuild, assertServedBuild } from './build-identity';
import { evaluateSameBlockTrajectory, TRAJECTORY_GATE_THRESHOLDS, type TrajectoryGateResult } from './trajectory-gate';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { gzip as gzipCallback } from 'node:zlib';
import { launchAdoptionChrome, BrowserProfiler, type ProfileCapture, withTimeout } from './combined-profiler';
import { percentile } from './combined-statistics';
import { metricStatistics, type MetricName } from './combined-metrics';
import {
  accelerationErrors,
  activeCpu,
  buildHash,
  clearOrigin,
  collectEnvironment,
  collectResourceManifest,
  COMBINED_BLOCK_ORDERS,
  enterCombinedWorld,
  harnessSnapshot,
  inspectAccelerationWorkers,
  memoryEvidence,
  NATURAL_INPUT_PLAN,
  naturalMotionErrors,
  runEditVisibleFeedback,
  runNaturalInput,
  type AccelerationInspection,
  type CombinedVariant,
} from './combined-support';

const gzip = promisify(gzipCallback);
const FROZEN_A_SHA = '79e05c53e8c8d199c24b438165c7f62aa69efc70';
const A_ORIGIN = process.env.SEEDLANDS_ADOPTION_A_ORIGIN ?? 'http://127.0.0.1:45891/';
const BLOCKS = Number(process.env.SEEDLANDS_ADOPTION_BLOCKS ?? 10);
const SAMPLE_MS = 30_000;
const WARMUP_MS = 5_000;
const EDIT_WARMUPS = 3;
const EDIT_SAMPLES = 20;
const RUN_TIMEOUT_MS = 300_000;
const EVIDENCE_PREFIX = 'changes/2026-09-07-data-plane-adoption/evidence/combined-';
const EXPECTED_PROFILE_ROLES = ['authority', 'fluid', 'general', 'logic', 'main', 'persistence'] as const;
const EXPECTED_WORKER_ROLES = EXPECTED_PROFILE_ROLES.filter((role) => role !== 'main');

type CombinedRun = {
  block: number;
  order: number;
  variant: CombinedVariant;
  sourceSha: string;
  sourceTreeHash: string;
  buildHash: string | null;
  url: string;
  startedAt: string;
  endedAt: string;
  status: 'valid' | 'invalid';
  invalidReasons: string[];
  browser: string;
  browserMode: 'headless-new';
  environment: object | null;
  workers: object | null;
  accelerationWorkers: AccelerationInspection[];
  metrics: Record<MetricName, number | null>;
  cpuByRoleMs: Record<string, number>;
  memory: object;
  counts: {
    frame: number;
    physics: number;
    editVisible: number;
    hiddenFrames: number;
    unfocusedFrames: number;
    missedPhysicsSamples: number;
  };
  trajectory: object;
};

type ResourceRecord = { buildHash: string; resources: object[] };

const git = (...arguments_: string[]) =>
  execFileSync('git', arguments_, { cwd: resolve('.'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

async function workingTreeIdentity(): Promise<{ sourceSha: string; treeHash: string; untracked: string[] }> {
  const sourceSha = git('rev-parse', 'HEAD');
  const diff = execFileSync('git', ['diff', '--binary', 'HEAD', '--', '.', `:(exclude)${EVIDENCE_PREFIX}*`], {
    cwd: resolve('.'),
    maxBuffer: 64 * 1024 * 1024,
  });
  const untracked = git('ls-files', '--others', '--exclude-standard')
    .split('\n')
    .filter((path) => path && !path.startsWith(EVIDENCE_PREFIX))
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

function parseSelectedRust(): string[] {
  const selected = [
    ...new Set(
      (process.env.SEEDLANDS_ADOPTION_SELECTED_RUST ?? '')
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ].sort();
  const invalid = selected.filter((name) => !/^[a-z0-9][a-z0-9_-]*$/i.test(name));
  if (invalid.length) throw new Error(`非法 Rust workload 标识：${invalid.join(',')}。`);
  return selected;
}

function origins(baseURL: string) {
  const aPrime = new URL(process.env.SEEDLANDS_ADOPTION_APRIME_ORIGIN ?? baseURL);
  const b = new URL(process.env.SEEDLANDS_ADOPTION_B_ORIGIN ?? 'http://127.0.0.1:45893/');
  const a = new URL(A_ORIGIN);
  if (a.origin === aPrime.origin) throw new Error('A 与 A′ 必须使用不同 origin。');
  if (b.origin === aPrime.origin) throw new Error('启用 Rust 时 B 必须使用独立 origin，以免静态资源缓存混淆。');
  return { A: a, A_PRIME: aPrime, B: b } satisfies Record<CombinedVariant, URL>;
}

function runUrl(variant: CombinedVariant, runOrigins: Record<CombinedVariant, URL>, selectedRust: readonly string[]) {
  const url = new URL(runOrigins[variant]);
  url.searchParams.set('harness', '1');
  url.searchParams.set('wasm', variant === 'B' && selectedRust.length ? selectedRust.join(',') : 'off');
  return url;
}

function workerErrors(
  snapshot: Awaited<ReturnType<typeof harnessSnapshot>>,
  captures: readonly ProfileCapture[],
  inspections: readonly AccelerationInspection[],
): string[] {
  if (!snapshot) return ['Harness snapshot 缺失。'];
  const errors: string[] = [];
  if (snapshot.workers.total !== 5 || EXPECTED_WORKER_ROLES.some((role) => snapshot.workers[role] !== 1))
    errors.push(`Harness Worker 预算改变：${JSON.stringify(snapshot.workers)}。`);
  const profileRoles = captures.map((capture) => capture.role).sort();
  if (profileRoles.join(',') !== [...EXPECTED_PROFILE_ROLES].sort().join(','))
    errors.push(`CPU profile 必须覆盖 main 与全部五个 Worker，实际为：${profileRoles.join(',')}。`);
  const inspectionRoles = inspections.map((inspection) => inspection.role).sort();
  if (inspectionRoles.join(',') !== [...EXPECTED_WORKER_ROLES].sort().join(','))
    errors.push(`CDP Worker target 改变：${inspectionRoles.join(',')}。`);
  return errors;
}

function productionBuildErrors(manifest: readonly object[]): string[] {
  const urls = manifest.map((entry) => (entry as { url?: string }).url ?? '');
  const errors: string[] = [];
  if (urls.some((url) => url.startsWith('/src/'))) errors.push('资源清单包含 /src/，不是 production build。');
  if (!urls.some((url) => /\/assets\/index-.*\.js$/.test(url))) errors.push('资源清单缺少 production index asset。');
  return errors;
}

test('A / A′ / B 十个平衡 block 的统一真实负载与编辑可见反馈', async ({ baseURL }, testInfo) => {
  test.skip(process.env.SEEDLANDS_ADOPTION_COMBINED !== '1', '统一性能采样必须显式启用。');
  test.setTimeout(7_200_000);
  if (!baseURL) throw new Error('Playwright baseURL 未配置。');
  if (!Number.isInteger(BLOCKS) || BLOCKS < 1 || BLOCKS > 10) throw new Error('BLOCKS must be 1..10');
  const selectedRust = parseSelectedRust();
  const runOrigins = origins(baseURL);
  const runId = (process.env.SEEDLANDS_ADOPTION_RUN_ID ?? new Date().toISOString()).replaceAll(/[^a-zA-Z0-9._-]/g, '-');
  const evidenceDirectory = new URL(`../evidence/combined-${runId}/`, import.meta.url);
  await mkdir(evidenceDirectory, { recursive: false });
  const initialTree = await workingTreeIdentity();
  const baselineBuild = await expectedBuild('/tmp/seedlands-adoption-baseline', FROZEN_A_SHA);
  const currentBuild = await expectedBuild(resolve('.'), initialTree.sourceSha);
  const expectedBuilds = { A: baselineBuild, A_PRIME: currentBuild, B: currentBuild };
  for (const variant of ['A', 'A_PRIME', 'B'] as const)
    await assertServedBuild(runOrigins[variant].origin, expectedBuilds[variant].files);
  const rustManifest = JSON.parse(await readFile('src/generated/wasm/rust-kernel-manifest.json', 'utf8'));

  const runs: CombinedRun[] = [];
  const trajectoryChecks: { block: number; result: TrajectoryGateResult }[] = [];
  const rawManifest: Array<{
    path: string;
    bytes: number;
    sha256: string;
    status: 'valid' | 'invalid';
    block: number;
    variant: CombinedVariant;
  }> = [];
  const resourceManifests: Partial<Record<CombinedVariant, ResourceRecord>> = {};
  const controls = {
    expectedBuilds,
    trajectoryThresholds: TRAJECTORY_GATE_THRESHOLDS,
    blocks: BLOCKS,
    diagnosticOnly: BLOCKS !== 10,
    blockOrders: COMBINED_BLOCK_ORDERS.slice(0, BLOCKS),
    orderDesign: 'pairwise-order-balanced',
    browserMode: 'headless-new',
    viewport: [1920, 1080],
    quality: 'medium',
    dpr: 1,
    workerBudget: 5,
    naturalWarmupMs: WARMUP_MS,
    naturalSampleMs: SAMPLE_MS,
    naturalInputPlan: NATURAL_INPUT_PLAN,
    editWarmups: EDIT_WARMUPS,
    editSamples: EDIT_SAMPLES,
    perRunTimeoutMs: RUN_TIMEOUT_MS,
    cachePolicy: '每次清空 origin storage；同一 Chrome 进程共享 HTTP 与编译缓存；首个样本不丢弃',
    bootstrapUnit: 'run',
    bootstrapIterations: 10_000,
    selectedRust,
    frozenA: { sourceSha: FROZEN_A_SHA, origin: runOrigins.A.origin },
    current: {
      sourceSha: initialTree.sourceSha,
      treeHash: initialTree.treeHash,
      untracked: initialTree.untracked,
      aPrimeOrigin: runOrigins.A_PRIME.origin,
      bOrigin: runOrigins.B.origin,
    },
    memorySemantics: {
      heap: 'Runtime.getHeapUsage end snapshot per isolate',
      rss: 'NOT_COLLECTED',
      gc: 'NOT_COLLECTED',
    },
  };
  const persistCheckpoint = async (complete: boolean) =>
    writeFile(
      new URL(complete ? 'combined-summary.json' : 'combined-checkpoint.json', evidenceDirectory),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          phase: 'combined-adoption',
          runId,
          generatedAt: new Date().toISOString(),
          complete,
          controls,
          resourceManifests,
          rawManifest,
          trajectoryChecks,
          runs,
          ...(complete ? { statistics: metricStatistics(runs) } : {}),
        },
        null,
        2,
      )}\n`,
    );

  const native = await launchAdoptionChrome();
  try {
    const context = native.browser.contexts()[0];
    if (!context) throw new Error('Chrome CDP 没有默认 BrowserContext。');
    for (const initialPage of context.pages()) await initialPage.close();
    for (const [blockIndex, order] of COMBINED_BLOCK_ORDERS.slice(0, BLOCKS).entries()) {
      for (const [orderIndex, variant] of order.entries()) {
        const page = await context.newPage();
        page.setDefaultTimeout(30_000);
        await page.setViewportSize({ width: 1920, height: 1080 });
        const url = runUrl(variant, runOrigins, selectedRust);
        const invalidReasons: string[] = [];
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        const profiler = new BrowserProfiler(native.debugPort, url.origin);
        let profileStarted = false;
        let captures: ProfileCapture[] = [];
        let environment: object | null = null;
        let workers: object | null = null;
        let accelerationWorkers: AccelerationInspection[] = [];
        let frameMs: number[] = [];
        let physicsMs: number[] = [];
        let editSamples: object[] = [];
        let hiddenFrames = 0;
        let unfocusedFrames = 0;
        let missedPhysicsSamples = 0;
        let readyMs: number | null = null;
        let before: object | null = null;
        let after: object | null = null;
        let checkpoints: object[] = [];
        let runBuildHash: string | null = null;
        const startedAt = new Date().toISOString();
        const executeRun = async () => {
          await clearOrigin(page, url.origin);
          readyMs = await enterCombinedWorld(page, url.href, `adoption-combined-${blockIndex + 1}`);
          const natural = await runNaturalInput(page, WARMUP_MS, SAMPLE_MS, async () => {
            profileStarted = true;
            await profiler.start();
          });
          ({ before, after, checkpoints, frameMs, physicsMs, hiddenFrames, unfocusedFrames, missedPhysicsSamples } =
            natural);
          captures = await profiler.stop();
          profileStarted = false;
          invalidReasons.push(...naturalMotionErrors(natural.before, natural.after, natural.checkpoints));
          editSamples = await runEditVisibleFeedback(page, EDIT_WARMUPS, EDIT_SAMPLES);
          environment = await collectEnvironment(page);
          const finalSnapshot = await harnessSnapshot(page);
          workers = finalSnapshot?.workers ?? null;
          accelerationWorkers = await inspectAccelerationWorkers(native.debugPort, url.origin);
          invalidReasons.push(
            ...accelerationErrors(variant, accelerationWorkers, selectedRust, rustManifest.simd.sha256),
          );
          invalidReasons.push(...workerErrors(finalSnapshot, captures, accelerationWorkers));
          await assertServedBuild(url.origin, expectedBuilds[variant].files);
          if (!resourceManifests[variant]) {
            const resources = await collectResourceManifest(
              page,
              accelerationWorkers.map((worker) => worker.url),
            );
            resourceManifests[variant] = { resources, buildHash: buildHash(resources) };
          }
          runBuildHash = resourceManifests[variant]!.buildHash;
          invalidReasons.push(...productionBuildErrors(resourceManifests[variant]!.resources));
          const measured = environment as {
            viewport?: number[];
            dpr?: number;
            visibilityState?: string;
            focused?: boolean;
          };
          if (measured.viewport?.join(',') !== '1920,1080') invalidReasons.push('CSS viewport 改变。');
          if (measured.dpr !== 1) invalidReasons.push(`DPR=${measured.dpr ?? 'UNKNOWN'}。`);
          if (measured.visibilityState !== 'visible' || !measured.focused)
            invalidReasons.push('运行结束时页面隐藏或失焦。');
          if (hiddenFrames || unfocusedFrames) invalidReasons.push('30 秒测量窗口发生隐藏或失焦。');
          if (missedPhysicsSamples) invalidReasons.push(`遗漏 ${missedPhysicsSamples} 个 physics sample。`);
          if (!frameMs.length || !physicsMs.length || editSamples.length !== EDIT_SAMPLES)
            invalidReasons.push('预注册指标样本不完整。');
        };
        try {
          await withTimeout(executeRun(), RUN_TIMEOUT_MS, `block ${blockIndex + 1} ${variant} 超过 5 分钟。`);
        } catch (error) {
          invalidReasons.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
          await page.close().catch(() => undefined);
          if (profileStarted) {
            captures = await profiler.stop().catch((stopError) => {
              invalidReasons.push(stopError instanceof Error ? stopError.message : String(stopError));
              return [];
            });
            profileStarted = false;
          }
        }
        invalidReasons.push(...pageErrors, ...profiler.errors);
        const cpu = activeCpu(captures);
        const editTotals = editSamples.map((sample) => (sample as { totalMs: number }).totalMs);
        const run: CombinedRun = {
          block: blockIndex + 1,
          order: orderIndex + 1,
          variant,
          sourceSha: variant === 'A' ? FROZEN_A_SHA : initialTree.sourceSha,
          sourceTreeHash: variant === 'A' ? FROZEN_A_SHA : initialTree.treeHash,
          buildHash: runBuildHash,
          url: url.href,
          startedAt,
          endedAt: new Date().toISOString(),
          status: invalidReasons.length ? 'invalid' : 'valid',
          invalidReasons,
          browser: native.browser.version(),
          browserMode: 'headless-new',
          environment,
          workers,
          accelerationWorkers,
          metrics: {
            readyMs,
            activeCpuMs: captures.length ? cpu.totalMs : null,
            frameP50Ms: frameMs.length ? percentile(frameMs, 0.5) : null,
            frameP95Ms: frameMs.length ? percentile(frameMs, 0.95) : null,
            frameP99Ms: frameMs.length ? percentile(frameMs, 0.99) : null,
            physicsP95Ms: physicsMs.length ? percentile(physicsMs, 0.95) : null,
            editVisibleP50Ms: editTotals.length ? percentile(editTotals, 0.5) : null,
            editVisibleP95Ms: editTotals.length ? percentile(editTotals, 0.95) : null,
            editVisibleP99Ms: editTotals.length ? percentile(editTotals, 0.99) : null,
          },
          cpuByRoleMs: cpu.roles,
          memory: memoryEvidence(captures),
          counts: {
            frame: frameMs.length,
            physics: physicsMs.length,
            editVisible: editSamples.length,
            hiddenFrames,
            unfocusedFrames,
            missedPhysicsSamples,
          },
          trajectory: {
            seed: `adoption-combined-${blockIndex + 1}`,
            input: NATURAL_INPUT_PLAN,
            before,
            checkpoints,
            after,
          },
        };
        const stem = `block-${String(blockIndex + 1).padStart(2, '0')}-${variant.toLowerCase()}`;
        const rawBytes = await gzip(
          JSON.stringify({
            schemaVersion: 1,
            run,
            pageErrors,
            profilerErrors: profiler.errors,
            cpu,
            frameMs,
            physicsMs,
            editVisibleSamples: editSamples,
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
        await page.close().catch(() => undefined);
      }
      const blockRuns = runs.filter((r) => r.block === blockIndex + 1);
      const result = evaluateSameBlockTrajectory(blockRuns, SAMPLE_MS);
      trajectoryChecks.push({ block: blockIndex + 1, result });
      for (const error of result.errors)
        for (const run of blockRuns) {
          run.status = 'invalid';
          run.invalidReasons.push(`同block负载门禁 ${error.scope}/${error.code}: ${error.message}`);
        }
      await persistCheckpoint(false);
    }

    for (const variant of ['A', 'A_PRIME', 'B'] as const)
      await assertServedBuild(runOrigins[variant].origin, expectedBuilds[variant].files);
    const finalTree = await workingTreeIdentity();
    if (finalTree.sourceSha !== initialTree.sourceSha || finalTree.treeHash !== initialTree.treeHash) {
      const reason = `测量期间源码树改变：${initialTree.sourceSha}/${initialTree.treeHash} -> ${finalTree.sourceSha}/${finalTree.treeHash}`;
      for (const run of runs) {
        run.status = 'invalid';
        run.invalidReasons.push(reason);
      }
    }
    const canvasSizes = new Set(
      runs
        .filter((run) => run.environment)
        .map((run) => (run.environment as { internalCanvas?: number[] }).internalCanvas?.join('x') ?? 'UNKNOWN'),
    );
    if (canvasSizes.size !== 1) {
      const reason = `变体内部 Canvas 尺寸不一致：${[...canvasSizes].join(',')}。`;
      for (const run of runs) {
        run.status = 'invalid';
        run.invalidReasons.push(reason);
      }
    }
    if (!selectedRust.length && resourceManifests.A_PRIME?.buildHash !== resourceManifests.B?.buildHash) {
      const reason = 'TS-only 结论下 A′ 与 B 应复跑同一 build，但实际 buildHash 不同。';
      for (const run of runs.filter((entry) => entry.variant !== 'A')) {
        run.status = 'invalid';
        run.invalidReasons.push(reason);
      }
    }
    if (
      selectedRust.length &&
      !resourceManifests.B?.resources.some((entry) => (entry as { url?: string }).url?.endsWith('.wasm'))
    ) {
      const reason = '启用 Rust 的 B 资源清单没有可追溯 Wasm 文件。';
      for (const run of runs.filter((entry) => entry.variant === 'B')) {
        run.status = 'invalid';
        run.invalidReasons.push(reason);
      }
    }
    for (const raw of rawManifest)
      raw.status = runs.find((run) => run.block === raw.block && run.variant === raw.variant)?.status ?? 'invalid';
    await persistCheckpoint(true);
    await testInfo.attach('combined-adoption-summary', {
      body: await readFile(new URL('combined-summary.json', evidenceDirectory)),
      contentType: 'application/json',
    });
    expect(runs, `证据目录：${relative(resolve('.'), evidenceDirectory.pathname)}`).toHaveLength(BLOCKS * 3);
    expect(runs.flatMap((run) => run.invalidReasons)).toEqual([]);
  } finally {
    await native.close();
  }
});
