import type { BrowserContext, CDPSession, Page, TestInfo } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  startClassicAuthorityCpuProfile,
  stopClassicAuthorityCpuProfile,
} from '../../e2e/classic-support/authority-cpu-profile';

type Attachment = Readonly<{ contentType: string; body: string | Buffer }>;
type Listener = (payload: unknown) => void;
type TargetInfo = Readonly<{ targetId: string; type: string; url: string }>;
type FakeOptions = Readonly<{
  targets?: readonly TargetInfo[];
  nestedReply?: (method: string, params: Record<string, unknown> | undefined) => unknown;
  holdNestedMethod?: string;
  wrongSessionOnHold?: boolean;
  detachTargetError?: Error;
  detachError?: Error;
}>;

const workerAsset = 'assets/authority-worker-abc.js';
const pageUrl = 'http://seedlands.test/play';
const assetSha = 'a'.repeat(64);
const enabledEnv = {
  SEEDLANDS_CLASSIC_AUTHORITY_CPU_PROFILE: '1',
  SEEDLANDS_HARNESS_RUN_ID: 'authority-run-88',
  SEEDLANDS_SOURCE_SHA: 'source-sha-88',
  SEEDLANDS_AUTHORITY_CPU_PROFILE_ASSET: workerAsset,
  SEEDLANDS_AUTHORITY_CPU_PROFILE_ASSET_SHA256: assetSha,
};

function fixture(options: FakeOptions = {}) {
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
  const defaultTargets = options.targets ?? [
    { targetId: 'authority-worker-target', type: 'worker', url: `http://seedlands.test/${workerAsset}` },
    { targetId: 'unrelated', type: 'worker', url: 'http://seedlands.test/assets/other-worker.js' },
  ];
  const send = vi.fn(async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
    if (method === 'Target.getTargets') return { targetInfos: defaultTargets };
    if (method === 'Target.attachToTarget') return { sessionId: 'attached-worker-session' };
    if (method === 'Target.detachFromTarget') {
      if (options.detachTargetError) throw options.detachTargetError;
      return {};
    }
    if (method === 'Target.sendMessageToTarget') {
      const envelope = JSON.parse(String(params?.message)) as {
        id: number;
        method: string;
        params?: Record<string, unknown>;
      };
      if (envelope.method === options.holdNestedMethod) {
        if (options.wrongSessionOnHold) {
          queueMicrotask(() =>
            emit('Target.receivedMessageFromTarget', {
              sessionId: 'unrelated-session',
              message: JSON.stringify({ id: envelope.id, result: {} }),
            }),
          );
        }
        return {};
      }
      const result =
        options.nestedReply?.(envelope.method, envelope.params) ??
        (envelope.method === 'Profiler.stop'
          ? { profile: { nodes: [{ id: 1, callFrame: { functionName: 'tick' } }] } }
          : {});
      queueMicrotask(() => {
        const response =
          result && typeof result === 'object' && 'error' in result
            ? { id: envelope.id, error: (result as { error: unknown }).error }
            : { id: envelope.id, result };
        emit('Target.receivedMessageFromTarget', {
          sessionId: 'attached-worker-session',
          message: JSON.stringify(response),
        });
      });
      return {};
    }
    return {};
  });
  const session = {
    send,
    detach: vi.fn(async () => {
      if (options.detachError) throw options.detachError;
    }),
    on,
    off,
  } as unknown as CDPSession & {
    send: typeof send;
    detach: ReturnType<typeof vi.fn>;
    on: typeof on;
    off: typeof off;
  };
  const newBrowserCDPSession = vi.fn(async () => session);
  const browser = { newBrowserCDPSession };
  const context = { browser: () => browser } as unknown as BrowserContext & { browser: () => typeof browser };
  const page = { context: () => context, url: () => pageUrl } as unknown as Page;
  const attach = vi.fn(async (_name: string, _attachment: Attachment) => undefined);
  const info = { title: 'Classic 生产旅程 V3', attach } as unknown as Pick<TestInfo, 'title' | 'attach'> & {
    attach: typeof attach;
  };
  return { page, info, session, newBrowserCDPSession, attach, emit, send };
}

afterEach(() => vi.useRealTimers());

describe('optional Classic Authority worker CPU profile', () => {
  it('keeps profiling disabled unless explicitly enabled', async () => {
    const run = fixture();
    await expect(startClassicAuthorityCpuProfile(run.page, run.info, false, {})).resolves.toBeUndefined();
    await stopClassicAuthorityCpuProfile(run.page, run.info);
    expect(run.newBrowserCDPSession).not.toHaveBeenCalled();
  });

  it('rejects visual, benchmark, conflicting profiler, and incomplete identity/asset metadata before CDP', async () => {
    const run = fixture();
    await expect(
      startClassicAuthorityCpuProfile(run.page, { title: 'Classic visual rebuild' }, false, enabledEnv),
    ).resolves.toBeUndefined();
    await expect(startClassicAuthorityCpuProfile(run.page, run.info, true, enabledEnv)).rejects.toThrow(/benchmark/i);
    await expect(
      startClassicAuthorityCpuProfile(run.page, run.info, false, { ...enabledEnv, SEEDLANDS_CLASSIC_BENCHMARK: '1' }),
    ).rejects.toThrow(/benchmark/i);
    await expect(
      startClassicAuthorityCpuProfile(run.page, run.info, false, { ...enabledEnv, SEEDLANDS_CLASSIC_CPU_PROFILE: '1' }),
    ).rejects.toThrow(/cpu|profil/i);
    await expect(
      startClassicAuthorityCpuProfile(run.page, run.info, false, {
        ...enabledEnv,
        SEEDLANDS_CLASSIC_NATIVE_TRACE: '1',
      }),
    ).rejects.toThrow(/diagnostic|profil/i);
    await expect(
      startClassicAuthorityCpuProfile(run.page, run.info, false, { ...enabledEnv, SEEDLANDS_SOURCE_SHA: undefined }),
    ).rejects.toThrow(/source\/run|identity/i);
    await expect(
      startClassicAuthorityCpuProfile(run.page, run.info, false, {
        ...enabledEnv,
        SEEDLANDS_AUTHORITY_CPU_PROFILE_ASSET_SHA256: 'bad',
      }),
    ).rejects.toThrow(/identity/i);
    expect(run.newBrowserCDPSession).not.toHaveBeenCalled();
  });

  it('records an early stop without attaching to a worker', async () => {
    vi.useFakeTimers();
    const run = fixture();
    await startClassicAuthorityCpuProfile(run.page, run.info, false, enabledEnv);
    await stopClassicAuthorityCpuProfile(run.page, run.info);
    await vi.advanceTimersByTimeAsync(360_000);
    expect(run.send).not.toHaveBeenCalledWith('Target.getTargets', expect.anything());
    expect(run.send).not.toHaveBeenCalledWith('Target.attachToTarget', expect.anything());
    expect(run.session.detach).toHaveBeenCalledTimes(1);
    expect(run.attach).toHaveBeenCalledTimes(1);
    const metadata = JSON.parse(String(run.attach.mock.calls[0]![1].body));
    expect(metadata).toMatchObject({ status: 'NOT_STARTED', diagnosticOnly: true, eligible: false });
  });

  it('profiles only the unique exact worker using nested CDP and attaches diagnostic data', async () => {
    vi.useFakeTimers();
    const run = fixture();
    await startClassicAuthorityCpuProfile(run.page, run.info, false, enabledEnv);
    await vi.advanceTimersByTimeAsync(360_000);
    await vi.advanceTimersByTimeAsync(20_000);
    await Promise.all([
      stopClassicAuthorityCpuProfile(run.page, run.info),
      stopClassicAuthorityCpuProfile(run.page, run.info),
    ]);

    expect(run.send).toHaveBeenCalledWith('Target.attachToTarget', {
      targetId: 'authority-worker-target',
      flatten: false,
    });
    const nestedMethods = run.send.mock.calls
      .filter(([method]) => method === 'Target.sendMessageToTarget')
      .map(([, params]) => JSON.parse(String(params?.message)).method);
    expect(nestedMethods).toEqual([
      'Profiler.enable',
      'Profiler.setSamplingInterval',
      'Profiler.start',
      'Profiler.stop',
    ]);
    expect(run.send).toHaveBeenCalledWith('Target.detachFromTarget', { sessionId: 'attached-worker-session' });
    expect(run.session.detach).toHaveBeenCalledTimes(1);
    expect(run.attach.mock.calls.map(([name]) => name)).toEqual([
      'classic-authority-worker-cpu-profile.json',
      'classic-authority-worker-cpu-profile-metadata.json',
    ]);
    expect(JSON.parse(String(run.attach.mock.calls[0]![1].body))).toMatchObject({ profile: { nodes: [{ id: 1 }] } });
    expect(JSON.parse(String(run.attach.mock.calls[1]![1].body))).toMatchObject({
      status: 'COMPLETE',
      diagnosticOnly: true,
      eligible: false,
      runId: 'authority-run-88',
      sourceSha: 'source-sha-88',
      asset: workerAsset,
      assetSha256: assetSha,
      targetInfo: { targetId: 'authority-worker-target', type: 'worker' },
    });
  });

  it('rejects ambiguous matching workers without attaching either target', async () => {
    vi.useFakeTimers();
    const run = fixture({
      targets: [
        { targetId: 'worker-a', type: 'worker', url: `http://seedlands.test/${workerAsset}` },
        { targetId: 'worker-b', type: 'worker', url: `http://seedlands.test/${workerAsset}` },
      ],
    });
    await startClassicAuthorityCpuProfile(run.page, run.info, false, enabledEnv);
    await vi.advanceTimersByTimeAsync(360_000);
    await expect(stopClassicAuthorityCpuProfile(run.page, run.info)).rejects.toBeInstanceOf(AggregateError);
    expect(run.send).not.toHaveBeenCalledWith('Target.attachToTarget', expect.anything());
    expect(run.session.detach).toHaveBeenCalledTimes(1);
    expect(run.attach).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(run.attach.mock.calls[0]![1].body))).toMatchObject({ status: 'FAILED', eligible: false });
  });

  it('rejects same-basename workers on another origin or base path', async () => {
    vi.useFakeTimers();
    const run = fixture({
      targets: [
        { targetId: 'other-origin', type: 'worker', url: `http://elsewhere.test/${workerAsset}` },
        { targetId: 'wrong-base', type: 'worker', url: `http://seedlands.test/wrong/${workerAsset}` },
      ],
    });
    await startClassicAuthorityCpuProfile(run.page, run.info, false, enabledEnv);
    await vi.advanceTimersByTimeAsync(360_000);
    await expect(stopClassicAuthorityCpuProfile(run.page, run.info)).rejects.toMatchObject({
      errors: [expect.objectContaining({ message: expect.stringContaining('found 0') })],
    });
    expect(run.send).not.toHaveBeenCalledWith('Target.attachToTarget', expect.anything());
    expect(run.attach).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(run.attach.mock.calls[0]![1].body))).toMatchObject({ status: 'FAILED', eligible: false });
  });

  it('propagates a nested Profiler error and cleans up the attached target', async () => {
    vi.useFakeTimers();
    const run = fixture({
      nestedReply: (method) =>
        method === 'Profiler.start' ? { error: { code: -32000, message: 'worker profiler denied' } } : {},
    });
    await startClassicAuthorityCpuProfile(run.page, run.info, false, enabledEnv);
    await vi.advanceTimersByTimeAsync(360_000);
    await expect(stopClassicAuthorityCpuProfile(run.page, run.info)).rejects.toMatchObject({
      errors: [expect.objectContaining({ message: expect.stringContaining('worker profiler denied') })],
    });
    expect(run.send).toHaveBeenCalledWith('Target.detachFromTarget', { sessionId: 'attached-worker-session' });
    expect(run.session.detach).toHaveBeenCalledTimes(1);
    expect(run.attach).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(run.attach.mock.calls[0]![1].body))).toMatchObject({ status: 'FAILED', eligible: false });
  });

  it('fails a pending nested request when the target detaches and still releases the browser session', async () => {
    vi.useFakeTimers();
    const run = fixture({ holdNestedMethod: 'Profiler.start' });
    await startClassicAuthorityCpuProfile(run.page, run.info, false, enabledEnv);
    await vi.advanceTimersByTimeAsync(360_000);
    run.emit('Target.detachedFromTarget', {
      sessionId: 'attached-worker-session',
      targetId: 'authority-worker-target',
    });
    await expect(stopClassicAuthorityCpuProfile(run.page, run.info)).rejects.toBeInstanceOf(AggregateError);
    expect(run.session.detach).toHaveBeenCalledTimes(1);
    expect(run.attach).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(run.attach.mock.calls[0]![1].body))).toMatchObject({ status: 'FAILED', eligible: false });
  });

  it('ignores wrong-session nested replies and times out the pending worker request', async () => {
    vi.useFakeTimers();
    const run = fixture({ holdNestedMethod: 'Profiler.enable', wrongSessionOnHold: true });
    await startClassicAuthorityCpuProfile(run.page, run.info, false, enabledEnv);
    await vi.advanceTimersByTimeAsync(360_000);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(stopClassicAuthorityCpuProfile(run.page, run.info)).rejects.toMatchObject({
      errors: [expect.objectContaining({ message: expect.stringContaining('Profiler.enable response timed out') })],
    });
    expect(run.send).toHaveBeenCalledWith('Target.detachFromTarget', { sessionId: 'attached-worker-session' });
    expect(run.session.detach).toHaveBeenCalledTimes(1);
    const metadata = JSON.parse(String(run.attach.mock.calls[0]![1].body)) as { status: string; errors: string[] };
    expect(metadata.status).toBe('FAILED');
    expect(metadata.errors.join('\n')).toContain('Profiler.enable response timed out');
  });

  it('preserves profiling and cleanup failures when target detach and browser detach both fail', async () => {
    vi.useFakeTimers();
    const targetCleanupError = new Error('target cleanup failed');
    const browserCleanupError = new Error('browser cleanup failed');
    const run = fixture({
      nestedReply: (method) =>
        method === 'Profiler.start' ? { error: { code: -1, message: 'profile start failed' } } : {},
      detachTargetError: targetCleanupError,
      detachError: browserCleanupError,
    });
    await startClassicAuthorityCpuProfile(run.page, run.info, false, enabledEnv);
    await vi.advanceTimersByTimeAsync(360_000);
    await expect(stopClassicAuthorityCpuProfile(run.page, run.info)).rejects.toMatchObject({
      errors: expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining('profile start failed') }),
        targetCleanupError,
        browserCleanupError,
      ]),
    });
    expect(run.attach).toHaveBeenCalledTimes(1);
    const metadata = JSON.parse(String(run.attach.mock.calls[0]![1].body)) as { errors: string[] };
    expect(metadata.errors.join('\n')).toContain('target cleanup failed');
    expect(metadata.errors.join('\n')).toContain('browser cleanup failed');
  });
});
