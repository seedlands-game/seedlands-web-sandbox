import type { BrowserContext, CDPSession, Page, TestInfo } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startClassicNativeTrace, stopClassicNativeTrace } from '../../e2e/classic-support/native-trace';

type Attachment = Readonly<{ contentType: string; body: string | Buffer }>;
type Listener = (payload: unknown) => void;
type SessionOptions = Readonly<{
  send?: (method: string, params?: unknown) => Promise<unknown>;
  detach?: () => Promise<void>;
}>;

const enabledEnv = {
  SEEDLANDS_CLASSIC_NATIVE_TRACE: '1',
  SEEDLANDS_HARNESS_RUN_ID: 'browser-run-86',
  SEEDLANDS_SOURCE_SHA: 'source-sha-86',
};

function fixture(options: SessionOptions = {}) {
  const listeners = new Map<string, Set<Listener>>();
  const on = vi.fn((event: string, listener: Listener) => {
    const handlers = listeners.get(event) ?? new Set<Listener>();
    handlers.add(listener);
    listeners.set(event, handlers);
  });
  const off = vi.fn((event: string, listener: Listener) => listeners.get(event)?.delete(listener));
  const emit = (event: string, payload: unknown) => {
    for (const listener of listeners.get(event) ?? []) listener(payload);
  };
  const defaultSend = async (method: string): Promise<unknown> => {
    if (method === 'Tracing.getCategories')
      return { categories: ['toplevel', 'gpu', 'cc', 'viz', 'devtools.timeline', 'gpu.service'] };
    if (method === 'Tracing.end') {
      queueMicrotask(() => emit('Tracing.tracingComplete', { stream: 'trace-stream', dataLossOccurred: false }));
      return {};
    }
    if (method === 'IO.read')
      return {
        data: Buffer.from(JSON.stringify({ traceEvents: [{ name: 'Frame', ts: 1 }] })).toString('base64'),
        eof: true,
        base64Encoded: true,
      };
    return {};
  };
  const session = {
    send: vi.fn(options.send ?? defaultSend),
    detach: vi.fn(options.detach ?? (async () => undefined)),
    on,
    off,
  } as unknown as CDPSession & {
    send: ReturnType<typeof vi.fn>;
    detach: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
  };
  const newBrowserCDPSession = vi.fn(async () => session);
  const browser = { newBrowserCDPSession };
  const context = { browser: () => browser } as unknown as BrowserContext & { browser: () => typeof browser };
  const page = { context: () => context } as unknown as Page;
  const attach = vi.fn(async (_name: string, _options: Attachment) => undefined);
  const info = { title: 'Classic 生产旅程 V3', attach } as unknown as Pick<TestInfo, 'title' | 'attach'> & {
    attach: typeof attach;
  };
  return { page, info, session, newBrowserCDPSession, attach, emit };
}

afterEach(() => vi.useRealTimers());

describe('optional Classic native trace', () => {
  it('does not borrow CDP when disabled or visual-only and refuses benchmark/profile modes', async () => {
    const disabled = fixture();
    await expect(startClassicNativeTrace(disabled.page, disabled.info, false, {})).resolves.toBeUndefined();
    await expect(
      startClassicNativeTrace(disabled.page, { title: 'Classic visual rebuild' }, false, enabledEnv),
    ).resolves.toBeUndefined();
    await expect(startClassicNativeTrace(disabled.page, disabled.info, true, enabledEnv)).rejects.toThrow(/benchmark/i);
    await expect(
      startClassicNativeTrace(disabled.page, disabled.info, false, {
        ...enabledEnv,
        SEEDLANDS_CLASSIC_BENCHMARK: '1',
      }),
    ).rejects.toThrow(/benchmark/i);
    await expect(
      startClassicNativeTrace(disabled.page, disabled.info, false, {
        ...enabledEnv,
        SEEDLANDS_CLASSIC_CPU_PROFILE: '1',
      }),
    ).rejects.toThrow(/profiling are mutually exclusive/i);
    expect(disabled.newBrowserCDPSession).not.toHaveBeenCalled();
  });

  it('requires source/run identity before creating a CDP session', async () => {
    const { page, info, newBrowserCDPSession } = fixture();
    await expect(startClassicNativeTrace(page, info, false, { SEEDLANDS_CLASSIC_NATIVE_TRACE: '1' })).rejects.toThrow(
      /SEEDLANDS_HARNESS_RUN_ID|SEEDLANDS_SOURCE_SHA/i,
    );
    expect(newBrowserCDPSession).not.toHaveBeenCalled();
  });

  it('rejects a missing required category and detaches the setup session', async () => {
    const run = fixture({
      send: async (method) =>
        method === 'Tracing.getCategories' ? { categories: ['toplevel', 'gpu', 'viz', 'devtools.timeline'] } : {},
    });
    await expect(startClassicNativeTrace(run.page, run.info, false, enabledEnv)).rejects.toThrow(/category cc/i);
    expect(run.session.detach).toHaveBeenCalledTimes(1);
    expect(run.attach).not.toHaveBeenCalled();
  });

  it('records early stop as NOT_STARTED, cancels the delayed start, and detaches once', async () => {
    vi.useFakeTimers();
    const run = fixture();
    await startClassicNativeTrace(run.page, run.info, false, enabledEnv);
    await stopClassicNativeTrace(run.page, run.info);
    await stopClassicNativeTrace(run.page, run.info);
    await vi.advanceTimersByTimeAsync(380_000);
    expect(run.session.send).not.toHaveBeenCalledWith('Tracing.start', expect.anything());
    expect(run.session.detach).toHaveBeenCalledTimes(1);
    expect(run.attach).toHaveBeenCalledTimes(1);
    const [name, options] = run.attach.mock.calls[0]!;
    expect(name).toBe('classic-native-trace-metadata.json');
    expect(JSON.parse(String(options.body))).toMatchObject({
      status: 'NOT_STARTED',
      runId: 'browser-run-86',
      eligible: false,
    });
  });

  it('captures after the scheduled delay, streams raw JSON once, and records complete metadata', async () => {
    vi.useFakeTimers();
    const run = fixture();
    await startClassicNativeTrace(run.page, run.info, false, enabledEnv);
    expect(run.session.send).toHaveBeenCalledWith('Tracing.getCategories');
    await vi.advanceTimersByTimeAsync(360_000);
    const tracingStart = run.session.send.mock.calls.find(([method]) => method === 'Tracing.start')?.[1] as {
      traceConfig?: { includedCategories?: string[] };
    };
    expect(tracingStart.traceConfig?.includedCategories).toEqual(
      expect.arrayContaining(['toplevel', 'gpu', 'cc', 'viz', 'devtools.timeline']),
    );
    expect(run.session.send).toHaveBeenCalledWith(
      'Tracing.start',
      expect.objectContaining({
        transferMode: 'ReturnAsStream',
        traceConfig: expect.objectContaining({ recordMode: 'recordUntilFull', traceBufferSizeInKb: 16_384 }),
      }),
    );
    await vi.advanceTimersByTimeAsync(5_000);
    expect(run.session.send.mock.calls.filter(([method]) => method === 'Tracing.end')).toHaveLength(1);
    await stopClassicNativeTrace(run.page, run.info);
    await stopClassicNativeTrace(run.page, run.info);
    expect(run.session.send.mock.calls.filter(([method]) => method === 'Tracing.end')).toHaveLength(1);
    expect(run.session.send).toHaveBeenCalledWith('IO.read', { handle: 'trace-stream', size: 65_536 });
    expect(run.session.send).toHaveBeenCalledWith('IO.close', { handle: 'trace-stream' });
    expect(run.session.detach).toHaveBeenCalledTimes(1);
    expect(run.attach).toHaveBeenCalledTimes(2);
    const raw = run.attach.mock.calls.find(([name]) => name === 'classic-native-trace.json')?.[1];
    const metadata = run.attach.mock.calls.find(([name]) => name === 'classic-native-trace-metadata.json')?.[1];
    expect(JSON.parse(String(raw?.body))).toMatchObject({ traceEvents: [{ name: 'Frame' }] });
    expect(JSON.parse(String(metadata?.body))).toMatchObject({
      status: 'COMPLETE',
      diagnosticOnly: true,
      eligible: false,
      runId: 'browser-run-86',
      sourceSha: 'source-sha-86',
      dataLossOccurred: false,
      durationMs: 5_000,
    });
  });

  it('retains raw diagnostics but rejects data loss and always closes the stream/session', async () => {
    vi.useFakeTimers();
    const run = fixture({
      send: async (method) => {
        if (method === 'Tracing.getCategories')
          return { categories: ['toplevel', 'gpu', 'cc', 'viz', 'devtools.timeline'] };
        if (method === 'Tracing.end') {
          queueMicrotask(() => run.emit('Tracing.tracingComplete', { stream: 'lost-stream', dataLossOccurred: true }));
          return {};
        }
        if (method === 'IO.read')
          return {
            data: Buffer.from(JSON.stringify({ traceEvents: [] })).toString('base64'),
            eof: true,
            base64Encoded: true,
          };
        return {};
      },
    });
    await startClassicNativeTrace(run.page, run.info, false, enabledEnv);
    await vi.advanceTimersByTimeAsync(360_000);
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(stopClassicNativeTrace(run.page, run.info)).rejects.toMatchObject({
      errors: [expect.objectContaining({ message: 'Native trace reported data loss.' })],
    });
    expect(run.attach.mock.calls.map(([name]) => name)).toEqual([
      'classic-native-trace.json',
      'classic-native-trace-metadata.json',
    ]);
    expect(JSON.parse(String(run.attach.mock.calls[1]![1].body))).toMatchObject({
      status: 'FAILED',
      dataLossOccurred: true,
      eligible: false,
    });
    expect(run.session.send).toHaveBeenCalledWith('IO.close', { handle: 'lost-stream' });
    expect(run.session.detach).toHaveBeenCalledTimes(1);
  });

  it('waits only ten seconds for tracingComplete and records the incomplete capture as failed', async () => {
    vi.useFakeTimers();
    const run = fixture({
      send: async (method) => {
        if (method === 'Tracing.getCategories')
          return { categories: ['toplevel', 'gpu', 'cc', 'viz', 'devtools.timeline'] };
        return {};
      },
    });
    await startClassicNativeTrace(run.page, run.info, false, enabledEnv);
    await vi.advanceTimersByTimeAsync(360_000);
    await vi.advanceTimersByTimeAsync(20_000);
    const stopping = stopClassicNativeTrace(run.page, run.info);
    const rejected = expect(stopping).rejects.toMatchObject({
      errors: [expect.objectContaining({ message: 'Native trace completion timed out.' })],
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(run.session.detach).toHaveBeenCalledTimes(1);
    expect(run.attach).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(run.attach.mock.calls[0]![1].body))).toMatchObject({
      status: 'FAILED',
      dataLossOccurred: null,
      bytes: 0,
    });
  });

  it('preserves both stream-read and stream-close failures while cleaning up', async () => {
    vi.useFakeTimers();
    const readError = new Error('stream read failed');
    const closeError = new Error('stream close failed');
    const run = fixture({
      send: async (method) => {
        if (method === 'Tracing.getCategories')
          return { categories: ['toplevel', 'gpu', 'cc', 'viz', 'devtools.timeline'] };
        if (method === 'Tracing.end') {
          queueMicrotask(() =>
            run.emit('Tracing.tracingComplete', { stream: 'broken-stream', dataLossOccurred: false }),
          );
          return {};
        }
        if (method === 'IO.read') throw readError;
        if (method === 'IO.close') throw closeError;
        return {};
      },
    });
    await startClassicNativeTrace(run.page, run.info, false, enabledEnv);
    await vi.advanceTimersByTimeAsync(360_000);
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(stopClassicNativeTrace(run.page, run.info)).rejects.toMatchObject({
      errors: [expect.objectContaining({ errors: [readError, closeError] })],
    });
    expect(run.session.detach).toHaveBeenCalledTimes(1);
    expect(run.attach.mock.calls.map(([name]) => name)).toEqual(['classic-native-trace-metadata.json']);
    expect(JSON.parse(String(run.attach.mock.calls[0]![1].body))).toMatchObject({ status: 'FAILED', bytes: 0 });
  });

  it('ends tracing after Tracing.start rejects and closes a completion stream it never reads', async () => {
    vi.useFakeTimers();
    const startError = new Error('Tracing.start failed after dispatch');
    const run = fixture({
      send: async (method) => {
        if (method === 'Tracing.getCategories')
          return { categories: ['toplevel', 'gpu', 'cc', 'viz', 'devtools.timeline'] };
        if (method === 'Tracing.start') throw startError;
        if (method === 'Tracing.end') {
          queueMicrotask(() =>
            run.emit('Tracing.tracingComplete', { stream: 'unused-stream', dataLossOccurred: false }),
          );
          return {};
        }
        return {};
      },
    });
    await startClassicNativeTrace(run.page, run.info, false, enabledEnv);
    await vi.advanceTimersByTimeAsync(360_000);
    await expect(stopClassicNativeTrace(run.page, run.info)).rejects.toMatchObject({
      errors: [expect.objectContaining({ message: startError.message })],
    });
    expect(run.session.send.mock.calls.filter(([method]) => method === 'Tracing.end')).toHaveLength(1);
    expect(run.session.send).toHaveBeenCalledWith('IO.close', { handle: 'unused-stream' });
    expect(run.session.send).not.toHaveBeenCalledWith('IO.read', expect.anything());
    expect(run.session.detach).toHaveBeenCalledTimes(1);
    expect(run.attach).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(run.attach.mock.calls[0]![1].body))).toMatchObject({ status: 'FAILED', bytes: 0 });
  });

  it('flattens original read and close errors into failure metadata', async () => {
    vi.useFakeTimers();
    const readError = new Error('original IO.read failure');
    const closeError = new Error('original IO.close failure');
    const run = fixture({
      send: async (method) => {
        if (method === 'Tracing.getCategories')
          return { categories: ['toplevel', 'gpu', 'cc', 'viz', 'devtools.timeline'] };
        if (method === 'Tracing.end') {
          queueMicrotask(() =>
            run.emit('Tracing.tracingComplete', { stream: 'read-close-stream', dataLossOccurred: false }),
          );
          return {};
        }
        if (method === 'IO.read') throw readError;
        if (method === 'IO.close') throw closeError;
        return {};
      },
    });
    await startClassicNativeTrace(run.page, run.info, false, enabledEnv);
    await vi.advanceTimersByTimeAsync(360_000);
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(stopClassicNativeTrace(run.page, run.info)).rejects.toMatchObject({
      errors: [expect.objectContaining({ errors: [readError, closeError] })],
    });
    const metadata = JSON.parse(String(run.attach.mock.calls[0]![1].body)) as { errors: string[] };
    expect(metadata.errors).toEqual(
      expect.arrayContaining([expect.stringContaining(readError.message), expect.stringContaining(closeError.message)]),
    );
    expect(run.session.detach).toHaveBeenCalledTimes(1);
  });

  it('closes a stream after enforcing the 64 MiB read cap', async () => {
    vi.useFakeTimers();
    const encodedChunk = Buffer.alloc(65_536, 0x20).toString('base64');
    const run = fixture({
      send: async (method) => {
        if (method === 'Tracing.getCategories')
          return { categories: ['toplevel', 'gpu', 'cc', 'viz', 'devtools.timeline'] };
        if (method === 'Tracing.end') {
          queueMicrotask(() =>
            run.emit('Tracing.tracingComplete', { stream: 'oversized-stream', dataLossOccurred: false }),
          );
          return {};
        }
        if (method === 'IO.read') return { data: encodedChunk, base64Encoded: true, eof: false };
        return {};
      },
    });
    await startClassicNativeTrace(run.page, run.info, false, enabledEnv);
    await vi.advanceTimersByTimeAsync(360_000);
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(stopClassicNativeTrace(run.page, run.info)).rejects.toMatchObject({
      errors: [
        expect.objectContaining({ errors: [expect.objectContaining({ message: expect.stringContaining('64 MiB') })] }),
      ],
    });
    expect(run.session.send.mock.calls.filter(([method]) => method === 'IO.read')).toHaveLength(1_025);
    expect(run.session.send).toHaveBeenCalledWith('IO.close', { handle: 'oversized-stream' });
    expect(run.session.detach).toHaveBeenCalledTimes(1);
    const metadata = JSON.parse(String(run.attach.mock.calls[0]![1].body)) as { errors: string[]; bytes: number };
    expect(metadata.bytes).toBe(0);
    expect(metadata.errors).toEqual(expect.arrayContaining([expect.stringContaining('64 MiB')]));
  });
});
