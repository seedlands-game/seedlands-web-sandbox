import type { CDPSession, Page, TestInfo } from '@playwright/test';

type ProfileRun = Readonly<{
  session: CDPSession;
  runId: string;
  sourceSha: string;
}> & { stopping?: Promise<void> };
const runs = new WeakMap<Page, ProfileRun>();
const samplingIntervalUs = 10_000;

async function rethrowAfterDetach(session: CDPSession, error: unknown): Promise<never> {
  try {
    await session.detach();
  } catch (cleanupError) {
    throw new AggregateError([error, cleanupError], 'CPU profile operation and detach both failed.', {
      cause: cleanupError,
    });
  }
  throw error;
}

export async function startClassicCpuProfile(
  page: Page,
  info: Pick<TestInfo, 'title'>,
  benchmark: boolean,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  if (env.SEEDLANDS_CLASSIC_CPU_PROFILE !== '1' || !info.title.startsWith('Classic 生产旅程')) return;
  if (benchmark || env.SEEDLANDS_CLASSIC_BENCHMARK === '1')
    throw new Error('Diagnostic CPU profiling cannot run in a benchmark.');
  const runId = env.SEEDLANDS_HARNESS_RUN_ID;
  const sourceSha = env.SEEDLANDS_SOURCE_SHA;
  if (!runId || !sourceSha) throw new Error('CPU profile needs SEEDLANDS_HARNESS_RUN_ID and SEEDLANDS_SOURCE_SHA.');
  if (runs.has(page)) throw new Error('This page already owns a CPU profile.');
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Profiler.enable');
    await session.send('Profiler.setSamplingInterval', { interval: samplingIntervalUs });
    await session.send('Profiler.start');
    runs.set(page, { session, runId, sourceSha });
  } catch (error) {
    return rethrowAfterDetach(session, error);
  }
}

async function finishProfile(run: ProfileRun, info: Pick<TestInfo, 'attach'>): Promise<void> {
  try {
    const response: unknown = await run.session.send('Profiler.stop');
    if (!response || typeof response !== 'object' || !('profile' in response) || !response.profile)
      throw new Error('Chromium did not return a CPU profile.');
    await info.attach('classic-main-thread-cpu-profile.json', {
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 1,
        diagnosticOnly: true,
        eligible: false,
        runId: run.runId,
        sourceSha: run.sourceSha,
        samplingIntervalUs,
        profile: response.profile,
      }),
    });
  } catch (error) {
    return rethrowAfterDetach(run.session, error);
  }
  await run.session.detach();
}

export async function stopClassicCpuProfile(page: Page, info: Pick<TestInfo, 'attach'>): Promise<void> {
  const run = runs.get(page);
  if (!run) return;
  run.stopping ??= finishProfile(run, info).finally(() => runs.delete(page));
  await run.stopping;
}
