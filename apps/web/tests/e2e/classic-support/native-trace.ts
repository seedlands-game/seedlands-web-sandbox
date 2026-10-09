import type { CDPSession, Page, TestInfo } from '@playwright/test';

const delayMs = 360_000;
const durationMs = 20_000;
const completionTimeoutMs = 10_000;
const maxBytes = 64 * 1024 * 1024;
const coreCategories = ['toplevel', 'gpu', 'cc', 'viz', 'devtools.timeline'];
const optionalCategories = ['disabled-by-default-gpu.service', 'disabled-by-default-gpu.debug'];
type Completion = { stream?: string; dataLossOccurred: boolean };
type NativeRun = {
  session: CDPSession;
  runId: string;
  sourceSha: string;
  categories: string[];
  availableCategories: string[];
  createdAt: string;
  createdMonotonic: number;
  timer?: ReturnType<typeof setTimeout>;
  capture?: Promise<void>;
  stopping?: Promise<void>;
  startedAt?: string;
  endedAt?: string;
  startElapsedMs?: number;
  captureElapsedMs?: number;
  dataLossOccurred: boolean | null;
  raw?: Buffer;
  errors: unknown[];
};
const runs = new WeakMap<Page, NativeRun>();

async function bounded<T>(operation: Promise<T>, label: string, timeoutMs = completionTimeoutMs): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Native trace ${label} timed out.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function readStream(run: NativeRun, handle: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  const errors: unknown[] = [];
  const deadline = performance.now() + completionTimeoutMs;
  try {
    for (;;) {
      if (performance.now() > deadline) throw new Error('Native trace stream drain timed out.');
      const result = await bounded(
        run.session.send('IO.read', { handle, size: 65_536 }),
        'stream read',
        Math.max(1, deadline - performance.now()),
      );
      const chunk = Buffer.from(result.data, result.base64Encoded ? 'base64' : 'utf8');
      bytes += chunk.byteLength;
      if (bytes > maxBytes) throw new Error('Native trace exceeds the 64 MiB stream limit.');
      chunks.push(chunk);
      if (result.eof) break;
    }
  } catch (error) {
    errors.push(error);
  } finally {
    try {
      await bounded(run.session.send('IO.close', { handle }), 'stream close');
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, 'Native trace stream read/close failed.');
  return Buffer.concat(chunks, bytes);
}

async function capture(run: NativeRun): Promise<void> {
  let complete: Completion | undefined;
  let resolveComplete: ((event: Completion) => void) | undefined;
  const onComplete = (event: Completion) => {
    complete = event;
    resolveComplete?.(event);
  };
  run.session.on('Tracing.tracingComplete', onComplete);
  let needsEnd = false;
  let streamHandled = false;
  try {
    needsEnd = true;
    await bounded(
      run.session.send('Tracing.start', {
        transferMode: 'ReturnAsStream',
        streamFormat: 'json',
        traceConfig: { recordMode: 'recordUntilFull', traceBufferSizeInKb: 16_384, includedCategories: run.categories },
      }),
      'start',
    );
    run.startedAt = new Date().toISOString();
    const start = performance.now();
    run.startElapsedMs = start - run.createdMonotonic;
    await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
    await bounded(run.session.send('Tracing.end'), 'end');
    needsEnd = false;
    run.endedAt = new Date().toISOString();
    run.captureElapsedMs = performance.now() - start;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const event =
        complete ??
        (await new Promise<Completion>((resolve, reject) => {
          resolveComplete = resolve;
          timeout = setTimeout(() => reject(new Error('Native trace completion timed out.')), completionTimeoutMs);
        }));
      run.dataLossOccurred = event.dataLossOccurred;
      if (!event.stream) throw new Error('Chromium did not return a native trace stream.');
      streamHandled = true;
      run.raw = await readStream(run, event.stream);
      const parsed: unknown = JSON.parse(run.raw.toString('utf8'));
      if (!parsed || typeof parsed !== 'object' || !('traceEvents' in parsed) || !Array.isArray(parsed.traceEvents))
        throw new Error('Native trace JSON has no traceEvents array.');
      if (event.dataLossOccurred) throw new Error('Native trace reported data loss.');
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  } catch (error) {
    run.errors.push(error);
  } finally {
    if (needsEnd) {
      try {
        await bounded(run.session.send('Tracing.end'), 'cleanup end');
      } catch (error) {
        run.errors.push(error);
      }
    }
    if (complete?.stream && !streamHandled) {
      try {
        await bounded(run.session.send('IO.close', { handle: complete.stream }), 'unused stream close');
      } catch (error) {
        run.errors.push(error);
      }
    }
    run.session.off('Tracing.tracingComplete', onComplete);
  }
}

function errorMessages(error: unknown): string[] {
  const message = error instanceof Error ? error.message : String(error);
  return error instanceof AggregateError ? [message, ...error.errors.flatMap(errorMessages)] : [message];
}

export async function startClassicNativeTrace(
  page: Page,
  info: Pick<TestInfo, 'title'>,
  benchmark: boolean,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  if (env.SEEDLANDS_CLASSIC_NATIVE_TRACE !== '1' || !info.title.startsWith('Classic 生产旅程')) return;
  if (benchmark || env.SEEDLANDS_CLASSIC_BENCHMARK === '1')
    throw new Error('Native tracing cannot run in a benchmark.');
  if (env.SEEDLANDS_CLASSIC_CPU_PROFILE === '1')
    throw new Error('Native tracing and CPU profiling are mutually exclusive.');
  const runId = env.SEEDLANDS_HARNESS_RUN_ID;
  const sourceSha = env.SEEDLANDS_SOURCE_SHA;
  if (!runId || !sourceSha) throw new Error('Native trace needs SEEDLANDS_HARNESS_RUN_ID and SEEDLANDS_SOURCE_SHA.');
  if (runs.has(page)) throw new Error('This page already owns a native trace.');
  const browser = page.context().browser();
  if (!browser) throw new Error('Native tracing requires a Chromium browser.');
  const session = await browser.newBrowserCDPSession();
  try {
    const available = (await bounded(session.send('Tracing.getCategories'), 'categories')).categories;
    for (const category of coreCategories)
      if (!available.includes(category)) throw new Error(`Native tracing lacks required category ${category}.`);
    const run: NativeRun = {
      session,
      runId,
      sourceSha,
      categories: [...coreCategories, ...optionalCategories.filter((category) => available.includes(category))],
      availableCategories: available,
      createdAt: new Date().toISOString(),
      createdMonotonic: performance.now(),
      dataLossOccurred: null,
      errors: [],
    };
    run.timer = setTimeout(() => {
      run.timer = undefined;
      run.capture = capture(run).catch((error: unknown) => {
        run.errors.push(error);
      });
    }, delayMs);
    runs.set(page, run);
  } catch (error) {
    try {
      await bounded(session.detach(), 'setup detach');
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Native trace setup and detach failed.', { cause: cleanupError });
    }
    throw error;
  }
}

async function finish(run: NativeRun, info: Pick<TestInfo, 'attach'>): Promise<void> {
  if (run.timer !== undefined) clearTimeout(run.timer);
  if (run.capture) await run.capture;
  try {
    await bounded(run.session.detach(), 'detach');
  } catch (error) {
    run.errors.push(error);
  }
  if (run.raw) {
    try {
      await info.attach('classic-native-trace.json', { contentType: 'application/json', body: run.raw });
    } catch (error) {
      run.errors.push(error);
    }
  }
  try {
    await info.attach('classic-native-trace-metadata.json', {
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 1,
        diagnosticOnly: true,
        eligible: false,
        runId: run.runId,
        sourceSha: run.sourceSha,
        status: run.errors.length ? 'FAILED' : run.capture ? 'COMPLETE' : 'NOT_STARTED',
        categories: run.categories,
        availableCategories: run.availableCategories,
        delayMs,
        durationMs,
        traceBufferSizeInKb: 16_384,
        maxBytes,
        completionTimeoutMs,
        createdAt: run.createdAt,
        startedAt: run.startedAt ?? null,
        endedAt: run.endedAt ?? null,
        startElapsedMs: run.startElapsedMs ?? null,
        captureElapsedMs: run.captureElapsedMs ?? null,
        dataLossOccurred: run.dataLossOccurred,
        bytes: run.raw?.byteLength ?? 0,
        errors: run.errors.flatMap(errorMessages),
      }),
    });
  } catch (error) {
    run.errors.push(error);
  }
  if (run.errors.length) throw new AggregateError(run.errors, 'Native trace diagnostic failed.');
}

export async function stopClassicNativeTrace(page: Page, info: Pick<TestInfo, 'attach'>): Promise<void> {
  const run = runs.get(page);
  if (!run) return;
  run.stopping ??= finish(run, info).finally(() => runs.delete(page));
  await run.stopping;
}
