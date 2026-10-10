import { describe, expect, it, vi } from 'vitest';
import type { Page, TestInfo } from '@playwright/test';
import { startClassicCpuProfile, stopClassicCpuProfile } from '../../e2e/classic-support/cpu-profile';

type FakeSession = {
  send: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
};
type AttachOptions = { contentType: string; body: Buffer | string };
type AttachSpy = ReturnType<typeof vi.fn<(name: string, options: AttachOptions) => Promise<void>>>;

const eligibleEnv = {
  SEEDLANDS_CLASSIC_CPU_PROFILE: '1',
  SEEDLANDS_HARNESS_RUN_ID: 'browser-run-73',
  SEEDLANDS_SOURCE_SHA: 'source-sha-73',
};

function fixture(
  options: {
    send?: (method: string, params?: unknown) => Promise<unknown>;
    detach?: () => Promise<void>;
    attach?: (name: string, options: AttachOptions) => Promise<void>;
  } = {},
) {
  const session: FakeSession = {
    send: vi.fn(options.send ?? (async () => ({}))),
    detach: vi.fn(options.detach ?? (async () => undefined)),
  };
  const newCDPSession = vi.fn(async () => session);
  const page = { context: () => ({ newCDPSession }) } as unknown as Page;
  const attach: AttachSpy = vi.fn(options.attach ?? (async () => undefined));
  const info = {
    title: 'Classic 生产旅程 V2',
    attach,
  } as unknown as Pick<TestInfo, 'title' | 'attach'>;
  return { page, info, session, newCDPSession, attach };
}

describe('optional Classic CPU profile', () => {
  it('does not open CDP when disabled or visual-only, and refuses benchmark mode before CDP', async () => {
    const disabled = fixture();
    await expect(startClassicCpuProfile(disabled.page, disabled.info, false, {})).resolves.toBeUndefined();
    await expect(
      startClassicCpuProfile(disabled.page, { title: 'Classic visual rebuild' }, false, eligibleEnv),
    ).resolves.toBeUndefined();
    await expect(startClassicCpuProfile(disabled.page, disabled.info, true, eligibleEnv)).rejects.toThrow(/benchmark/i);
    await expect(
      startClassicCpuProfile(disabled.page, disabled.info, false, {
        ...eligibleEnv,
        SEEDLANDS_CLASSIC_BENCHMARK: '1',
      }),
    ).rejects.toThrow(/benchmark/i);
    expect(disabled.newCDPSession).not.toHaveBeenCalled();
  });

  it('requires run identity before opening CDP', async () => {
    const { page, info, newCDPSession } = fixture();
    await expect(startClassicCpuProfile(page, info, false, { SEEDLANDS_CLASSIC_CPU_PROFILE: '1' })).rejects.toThrow(
      /SEEDLANDS_HARNESS_RUN_ID|SEEDLANDS_SOURCE_SHA/i,
    );
    expect(newCDPSession).not.toHaveBeenCalled();
  });

  it('starts in order and attaches one diagnostic-only profile on concurrent/idempotent stop', async () => {
    const rawProfile = { nodes: [{ id: 1, callFrame: { functionName: 'receive' }, hitCount: 2 }] };
    const { page, info, session, attach } = fixture({
      send: async (method) => (method === 'Profiler.stop' ? { profile: rawProfile } : {}),
    });
    await startClassicCpuProfile(page, info, false, eligibleEnv);
    expect(session.send.mock.calls.map(([method]) => method)).toEqual([
      'Profiler.enable',
      'Profiler.setSamplingInterval',
      'Profiler.start',
    ]);
    expect(session.send).toHaveBeenNthCalledWith(2, 'Profiler.setSamplingInterval', { interval: 10_000 });

    await Promise.all([stopClassicCpuProfile(page, info), stopClassicCpuProfile(page, info)]);
    await stopClassicCpuProfile(page, info);
    expect(session.send.mock.calls.map(([method]) => method)).toEqual([
      'Profiler.enable',
      'Profiler.setSamplingInterval',
      'Profiler.start',
      'Profiler.stop',
    ]);
    expect(attach).toHaveBeenCalledTimes(1);
    const [attachmentName, attachmentOptions] = attach.mock.calls[0]!;
    expect(attachmentName).toBe('classic-main-thread-cpu-profile.json');
    expect(attachmentOptions.contentType).toBe('application/json');
    expect(JSON.parse(String(attachmentOptions.body))).toEqual({
      schemaVersion: 1,
      diagnosticOnly: true,
      eligible: false,
      runId: 'browser-run-73',
      sourceSha: 'source-sha-73',
      samplingIntervalUs: 10_000,
      profile: rawProfile,
    });
    expect(session.detach).toHaveBeenCalledTimes(1);
  });

  it('makes stop without a matching start a no-op and rejects missing profile data after cleanup', async () => {
    const idle = fixture();
    await stopClassicCpuProfile(idle.page, idle.info);
    expect(idle.newCDPSession).not.toHaveBeenCalled();

    const active = fixture({ send: async () => ({}) });
    await startClassicCpuProfile(active.page, active.info, false, eligibleEnv);
    await expect(stopClassicCpuProfile(active.page, active.info)).rejects.toThrow(/profile/i);
    expect(active.attach).not.toHaveBeenCalled();
    expect(active.session.detach).toHaveBeenCalledTimes(1);
  });

  it('cleans up and preserves start, stop, or attachment errors', async () => {
    const startError = new Error('start failed');
    const failedStart = fixture({
      send: async (method) => {
        if (method === 'Profiler.start') throw startError;
        return {};
      },
    });
    await expect(startClassicCpuProfile(failedStart.page, failedStart.info, false, eligibleEnv)).rejects.toBe(
      startError,
    );
    expect(failedStart.session.detach).toHaveBeenCalledTimes(1);

    const detachError = new Error('detach failed');
    const failedCleanup = fixture({
      send: async (method) => {
        if (method === 'Profiler.start') throw startError;
        return {};
      },
      detach: async () => {
        throw detachError;
      },
    });
    await expect(
      startClassicCpuProfile(failedCleanup.page, failedCleanup.info, false, eligibleEnv),
    ).rejects.toMatchObject({
      errors: [startError, detachError],
    });

    const stopError = new Error('stop failed');
    const failedStop = fixture({
      send: async (method) => {
        if (method === 'Profiler.stop') throw stopError;
        return {};
      },
    });
    await startClassicCpuProfile(failedStop.page, failedStop.info, false, eligibleEnv);
    await expect(stopClassicCpuProfile(failedStop.page, failedStop.info)).rejects.toBe(stopError);
    expect(failedStop.session.detach).toHaveBeenCalledTimes(1);

    const attachError = new Error('attachment failed');
    const failedAttach = fixture({
      send: async (method) => (method === 'Profiler.stop' ? { profile: { nodes: [] } } : {}),
      attach: async () => {
        throw attachError;
      },
    });
    await startClassicCpuProfile(failedAttach.page, failedAttach.info, false, eligibleEnv);
    await expect(stopClassicCpuProfile(failedAttach.page, failedAttach.info)).rejects.toBe(attachError);
    expect(failedAttach.session.detach).toHaveBeenCalledTimes(1);
  });
});
