import type { CDPSession, Page, TestInfo } from '@playwright/test';
import { WorkerTargetSession, withCdpTimeout } from './target-session';

const delayMs = 360_000;
const durationMs = 20_000;
const samplingIntervalUs = 10_000;
type TargetInfo = { targetId: string; type: string; url: string; browserContextId?: string };
type Run = {
  browser: CDPSession;
  page: Page;
  runId: string;
  sourceSha: string;
  asset: string;
  assetSha256: string;
  createdAt: string;
  createdMonotonic: number;
  timer?: ReturnType<typeof setTimeout>;
  capture?: Promise<void>;
  stopping?: Promise<void>;
  target?: TargetInfo;
  startedAt?: string;
  endedAt?: string;
  startElapsedMs?: number;
  captureElapsedMs?: number;
  profile?: unknown;
  errors: unknown[];
};
const runs = new WeakMap<Page, Run>();

async function capture(run: Run): Promise<void> {
  let worker: WorkerTargetSession | undefined;
  let needsStop = false;
  try {
    const targets = await withCdpTimeout(
      run.browser.send('Target.getTargets', {
        filter: [{ type: 'worker', exclude: false }, { exclude: true }],
      }),
      'Worker target discovery',
    );
    const expectedUrl = new URL(run.asset, run.page.url());
    const matches = targets.targetInfos.filter((target) => {
      if (target.type !== 'worker') return false;
      try {
        const url = new URL(target.url);
        return url.href === expectedUrl.href && !url.username && !url.password;
      } catch {
        return false;
      }
    });
    if (matches.length !== 1) throw new Error(`Expected one exact Authority worker target; found ${matches.length}.`);
    run.target = matches[0]!;
    const attached = await withCdpTimeout(
      run.browser.send('Target.attachToTarget', {
        targetId: run.target.targetId,
        flatten: false,
      }),
      'Worker target attach',
    );
    worker = new WorkerTargetSession(run.browser, attached.sessionId);
    await worker.send('Profiler.enable');
    await worker.send('Profiler.setSamplingInterval', { interval: samplingIntervalUs });
    needsStop = true;
    await worker.send('Profiler.start');
    run.startedAt = new Date().toISOString();
    const start = performance.now();
    run.startElapsedMs = start - run.createdMonotonic;
    await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
    const result = await worker.send('Profiler.stop');
    needsStop = false;
    run.endedAt = new Date().toISOString();
    run.captureElapsedMs = performance.now() - start;
    if (!result || typeof result !== 'object' || !('profile' in result) || !result.profile)
      throw new Error('Authority worker did not return a CPU profile.');
    run.profile = result.profile;
  } catch (error) {
    run.errors.push(error);
  } finally {
    if (needsStop && worker) {
      try {
        await worker.send('Profiler.stop');
      } catch (error) {
        run.errors.push(error);
      }
    }
    if (worker) {
      try {
        await worker.detach();
      } catch (error) {
        run.errors.push(error);
      }
    }
  }
}

export async function startClassicAuthorityCpuProfile(
  page: Page,
  info: Pick<TestInfo, 'title'>,
  benchmark: boolean,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  if (env.SEEDLANDS_CLASSIC_AUTHORITY_CPU_PROFILE !== '1' || !info.title.startsWith('Classic 生产旅程')) return;
  if (benchmark || env.SEEDLANDS_CLASSIC_BENCHMARK === '1')
    throw new Error('Worker CPU profiling cannot run in a benchmark.');
  if (env.SEEDLANDS_CLASSIC_CPU_PROFILE === '1' || env.SEEDLANDS_CLASSIC_NATIVE_TRACE === '1')
    throw new Error('Worker CPU profiling is mutually exclusive with main CPU and native diagnostics.');
  const runId = env.SEEDLANDS_HARNESS_RUN_ID;
  const sourceSha = env.SEEDLANDS_SOURCE_SHA;
  const asset = env.SEEDLANDS_AUTHORITY_CPU_PROFILE_ASSET;
  const assetSha256 = env.SEEDLANDS_AUTHORITY_CPU_PROFILE_ASSET_SHA256;
  if (!runId || !sourceSha || !asset || !assetSha256)
    throw new Error('Worker CPU profile needs source/run and artifact-derived asset identity.');
  if (!/^assets\/authority-worker-[A-Za-z0-9_-]+\.js$/.test(asset) || !/^[0-9a-f]{64}$/.test(assetSha256))
    throw new Error('Worker CPU profile artifact identity is invalid.');
  if (runs.has(page)) throw new Error('This page already owns a worker CPU profile.');
  const browser = page.context().browser();
  if (!browser) throw new Error('Worker profiling requires a Chromium browser.');
  const session = await browser.newBrowserCDPSession();
  const run: Run = {
    browser: session,
    page,
    runId,
    sourceSha,
    asset,
    assetSha256,
    createdAt: new Date().toISOString(),
    createdMonotonic: performance.now(),
    errors: [],
  };
  run.timer = setTimeout(() => {
    run.timer = undefined;
    run.capture = capture(run).catch((error: unknown) => {
      run.errors.push(error);
    });
  }, delayMs);
  runs.set(page, run);
}

function errorMessages(error: unknown): string[] {
  const message = error instanceof Error ? error.message : String(error);
  return error instanceof AggregateError ? [message, ...error.errors.flatMap(errorMessages)] : [message];
}

async function finish(run: Run, info: Pick<TestInfo, 'attach'>): Promise<void> {
  if (run.timer !== undefined) clearTimeout(run.timer);
  if (run.capture) await run.capture;
  try {
    await withCdpTimeout(run.browser.detach(), 'Worker browser session detach');
  } catch (error) {
    run.errors.push(error);
  }
  if (run.profile) {
    try {
      await info.attach('classic-authority-worker-cpu-profile.json', {
        contentType: 'application/json',
        body: JSON.stringify({
          schemaVersion: 1,
          diagnosticOnly: true,
          eligible: false,
          sourceSha: run.sourceSha,
          runId: run.runId,
          targetInfo: run.target,
          asset: run.asset,
          assetSha256: run.assetSha256,
          samplingIntervalUs,
          profile: run.profile,
        }),
      });
    } catch (error) {
      run.errors.push(error);
    }
  }
  try {
    await info.attach('classic-authority-worker-cpu-profile-metadata.json', {
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 1,
        diagnosticOnly: true,
        eligible: false,
        sourceSha: run.sourceSha,
        runId: run.runId,
        targetInfo: run.target ?? null,
        asset: run.asset,
        assetSha256: run.assetSha256,
        delayMs,
        durationMs,
        samplingIntervalUs,
        status: run.errors.length ? 'FAILED' : run.capture ? 'COMPLETE' : 'NOT_STARTED',
        createdAt: run.createdAt,
        startedAt: run.startedAt ?? null,
        endedAt: run.endedAt ?? null,
        startElapsedMs: run.startElapsedMs ?? null,
        captureElapsedMs: run.captureElapsedMs ?? null,
        errors: run.errors.flatMap(errorMessages),
      }),
    });
  } catch (error) {
    run.errors.push(error);
  }
  if (run.errors.length) throw new AggregateError(run.errors, 'Authority worker CPU diagnostic failed.');
}

export async function stopClassicAuthorityCpuProfile(page: Page, info: Pick<TestInfo, 'attach'>): Promise<void> {
  const run = runs.get(page);
  if (!run) return;
  run.stopping ??= finish(run, info).finally(() => runs.delete(page));
  await run.stopping;
}
