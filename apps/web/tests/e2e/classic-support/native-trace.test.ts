import type { Page, TestInfo } from '@playwright/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startClassicNativeTrace, stopClassicNativeTrace } from './native-trace';

const env = {
  SEEDLANDS_CLASSIC_NATIVE_TRACE: '1',
  SEEDLANDS_HARNESS_RUN_ID: 'native-stage-contract',
  SEEDLANDS_SOURCE_SHA: 'source-contract',
};
const title = { title: 'Classic 生产旅程 native contract' };

function fixture() {
  const session = {
    send: vi.fn().mockResolvedValue({ categories: ['toplevel', 'gpu', 'cc', 'viz', 'devtools.timeline'] }),
    detach: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
  };
  const newBrowserCDPSession = vi.fn().mockResolvedValue(session);
  const page = { context: () => ({ browser: () => ({ newBrowserCDPSession }) }) } as unknown as Page;
  const attach = vi.fn().mockResolvedValue(undefined);
  const info = { attach } as Pick<TestInfo, 'attach'>;
  const metadata = () =>
    JSON.parse(attach.mock.calls.find(([name]) => name === 'classic-native-trace-metadata.json')![1].body);
  return { page, session, newBrowserCDPSession, info, attach, metadata };
}

describe('Classic native trace stage boundary', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('defers C4 without allocating a session or timer and records an unreached stage', async () => {
    const f = fixture();
    await startClassicNativeTrace(f.page, title, false, { ...env, SEEDLANDS_CLASSIC_NATIVE_TRACE_STAGE: 'C4' });
    expect(f.newBrowserCDPSession).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await stopClassicNativeTrace(f.page, f.info);
    expect(f.metadata()).toMatchObject({
      stage: 'C4',
      status: 'NOT_STARTED',
      delayMs: 0,
      bytes: 0,
      diagnosticOnly: true,
      eligible: false,
    });
    expect(f.attach.mock.calls.map(([name]) => name)).toEqual(['classic-native-trace-metadata.json']);
    await stopClassicNativeTrace(f.page, f.info);
    expect(f.attach).toHaveBeenCalledTimes(1);
  });

  it('activates C4 once with zero delay and retains source identity and cleanup', async () => {
    const f = fixture();
    const request = { ...env, SEEDLANDS_CLASSIC_NATIVE_TRACE_STAGE: 'C4' };
    await startClassicNativeTrace(f.page, title, false, request);
    await startClassicNativeTrace(f.page, title, false, request, 'C4');
    expect(f.newBrowserCDPSession).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    await expect(startClassicNativeTrace(f.page, title, false, request, 'C4')).rejects.toThrow('already owns');
    await stopClassicNativeTrace(f.page, f.info);
    expect(f.metadata()).toMatchObject({
      stage: 'C4',
      delayMs: 0,
      durationMs: 5000,
      runId: env.SEEDLANDS_HARNESS_RUN_ID,
      sourceSha: env.SEEDLANDS_SOURCE_SHA,
    });
    expect(f.session.detach).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the default six minute delay and ignores the later C4 hook', async () => {
    const f = fixture();
    await startClassicNativeTrace(f.page, title, false, env);
    await startClassicNativeTrace(f.page, title, false, env, 'C4');
    expect(f.newBrowserCDPSession).toHaveBeenCalledTimes(1);
    await stopClassicNativeTrace(f.page, f.info);
    expect(f.metadata()).toMatchObject({ stage: 'main', delayMs: 360000, status: 'NOT_STARTED' });
    expect(f.session.detach).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])(
    'captures the original five second stream and preserves data loss rejection: %s',
    async (dataLossOccurred) => {
      const f = fixture();
      f.session.send.mockImplementation(async (method: string) => {
        if (method === 'Tracing.getCategories')
          return { categories: ['toplevel', 'gpu', 'cc', 'viz', 'devtools.timeline'] };
        if (method === 'Tracing.end') f.session.on.mock.calls[0][1]({ stream: 'trace-stream', dataLossOccurred });
        if (method === 'IO.read') return { data: '{"traceEvents":[]}', eof: true };
        return {};
      });
      const request = { ...env, SEEDLANDS_CLASSIC_NATIVE_TRACE_STAGE: 'C4' };
      await startClassicNativeTrace(f.page, title, false, request);
      await startClassicNativeTrace(f.page, title, false, request, 'C4');
      await vi.advanceTimersByTimeAsync(0);
      expect(f.session.send.mock.calls.some(([method]) => method === 'Tracing.start')).toBe(true);
      expect(f.session.send.mock.calls.some(([method]) => method === 'Tracing.end')).toBe(false);
      await vi.advanceTimersByTimeAsync(4999);
      expect(f.session.send.mock.calls.some(([method]) => method === 'Tracing.end')).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const stopping = stopClassicNativeTrace(f.page, f.info);
      if (dataLossOccurred) await expect(stopping).rejects.toThrow('diagnostic failed');
      else await stopping;
      expect(f.metadata()).toMatchObject({
        stage: 'C4',
        status: dataLossOccurred ? 'FAILED' : 'COMPLETE',
        dataLossOccurred,
        bytes: 18,
      });
      expect(f.session.send).toHaveBeenCalledWith('IO.close', { handle: 'trace-stream' });
      expect(f.session.off).toHaveBeenCalledTimes(1);
      expect(f.session.detach).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each([
    [{ SEEDLANDS_CLASSIC_BENCHMARK: '1' }, false, 'benchmark'],
    [{}, true, 'benchmark'],
    [{ SEEDLANDS_CLASSIC_CPU_PROFILE: '1' }, false, 'mutually exclusive'],
    [{ SEEDLANDS_CLASSIC_NATIVE_TRACE_STAGE: 'unknown' }, false, 'stage'],
  ] as const)('rejects incompatible requests before deferral or allocation: %j', async (extra, benchmark, message) => {
    const f = fixture();
    await expect(
      startClassicNativeTrace(f.page, title, benchmark, {
        ...env,
        SEEDLANDS_CLASSIC_NATIVE_TRACE_STAGE: 'C4',
        ...extra,
      }),
    ).rejects.toThrow(message);
    expect(f.newBrowserCDPSession).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await stopClassicNativeTrace(f.page, f.info);
    expect(f.attach).not.toHaveBeenCalled();
  });

  it('bypasses disabled tracing even with an unknown stage', async () => {
    const f = fixture();
    await startClassicNativeTrace(f.page, title, false, {
      ...env,
      SEEDLANDS_CLASSIC_NATIVE_TRACE: '0',
      SEEDLANDS_CLASSIC_NATIVE_TRACE_STAGE: 'unknown',
    });
    await stopClassicNativeTrace(f.page, f.info);
    expect(f.newBrowserCDPSession).not.toHaveBeenCalled();
    expect(f.attach).not.toHaveBeenCalled();
  });

  it('rejects identity changes between deferral and C4 before allocating CDP', async () => {
    const f = fixture();
    const request = { ...env, SEEDLANDS_CLASSIC_NATIVE_TRACE_STAGE: 'C4' };
    await startClassicNativeTrace(f.page, title, false, request);
    await expect(
      startClassicNativeTrace(f.page, title, false, { ...request, SEEDLANDS_SOURCE_SHA: 'different' }, 'C4'),
    ).rejects.toThrow('identity');
    expect(f.newBrowserCDPSession).not.toHaveBeenCalled();
    await stopClassicNativeTrace(f.page, f.info);
    expect(f.metadata()).toMatchObject({ sourceSha: env.SEEDLANDS_SOURCE_SHA, status: 'NOT_STARTED' });
  });

  it('retains a failed C4 activation instead of reporting an unreached capture', async () => {
    const f = fixture();
    const request = { ...env, SEEDLANDS_CLASSIC_NATIVE_TRACE_STAGE: 'C4' };
    await startClassicNativeTrace(f.page, title, false, request);
    f.session.send.mockRejectedValueOnce(new Error('categories unavailable'));
    await expect(startClassicNativeTrace(f.page, title, false, request, 'C4')).rejects.toThrow(
      'categories unavailable',
    );
    await stopClassicNativeTrace(f.page, f.info);
    expect(f.metadata()).toMatchObject({ stage: 'C4', status: 'FAILED', bytes: 0 });
    expect(f.session.detach).toHaveBeenCalledTimes(1);
    expect(f.attach.mock.calls.map(([name]) => name)).toEqual(['classic-native-trace-metadata.json']);
    expect(vi.getTimerCount()).toBe(0);
  });
});
