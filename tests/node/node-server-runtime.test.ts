import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createNodeServerRuntime } from '../../src/node/server/node-server-runtime';

const factories = vi.hoisted(() => ({ persistence: vi.fn(), authority: vi.fn() }));
vi.mock('../../src/node/persistence/node-persistence-lane', () => ({
  createNodePersistenceLane: factories.persistence,
}));
vi.mock('../../src/node/runtime/node-authority-lane', () => ({
  createNodeAuthorityLane: factories.authority,
}));

const options = {
  dataDirectory: '/unused-test-world',
  seedText: 'lane-lifecycle',
  entries: {
    authority: new URL('file:///unused/node-authority-worker.js'),
    persistence: new URL('file:///unused/node-persistence-worker.js'),
    worker: new URL('file:///unused/node-compute-worker.js'),
    child: new URL('file:///unused/node-compute-child.js'),
  },
};
const pending = () => new Promise<never>(() => {});

beforeEach(() => vi.resetAllMocks());

describe('Node 产品宿主生命周期', () => {
  it('最终权威保存先于存储关闭，幂等stop保持同一结果并等待全部资源释放', async () => {
    const events: string[] = [];
    factories.persistence.mockResolvedValue({
      authorityPort: {},
      threadId: 2,
      proxy: { identity: {}, limits: {} },
      whenExited: pending,
      whenFailed: pending,
      close: vi.fn(async () => {
        events.push('persistence-close');
      }),
    });
    factories.authority.mockResolvedValue({
      threadId: 3,
      whenExited: pending,
      whenFailed: pending,
      stop: vi.fn(async () => {
        events.push('authority-save');
        return { status: 'stopped', durableCommitSequence: 7 };
      }),
      close: vi.fn(async () => {
        events.push('authority-close');
      }),
    });
    const runtime = await createNodeServerRuntime(options);
    expect(runtime.authorityThreadId).not.toBe(runtime.persistenceThreadId);
    expect('host' in runtime).toBe(false);
    const stop = runtime.stop();
    expect(runtime.stop()).toBe(stop);
    await expect(stop).resolves.toEqual({ status: 'stopped', durableCommitSequence: 7 });
    await expect(runtime.whenStopped()).resolves.toEqual({ status: 'stopped', durableCommitSequence: 7 });
    expect(events).toEqual(['authority-save', 'persistence-close', 'authority-close']);
    expect(runtime.state).toBe('stopped');
  });

  it('Authority启动失败时关闭已启动的存储线程', async () => {
    const close = vi.fn(async () => {});
    factories.persistence.mockResolvedValue({ authorityPort: {}, proxy: { identity: {}, limits: {} }, close });
    factories.authority.mockRejectedValue(new Error('authority-startup-failed'));
    await expect(createNodeServerRuntime(options)).rejects.toThrow('authority-startup-failed');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('关停期限只拒绝调用，不提前关闭仍在最终写入的存储或报告stopped', async () => {
    vi.useFakeTimers();
    try {
      let finish!: (result: { status: 'stopped'; durableCommitSequence: number }) => void;
      const saving = new Promise<{ status: 'stopped'; durableCommitSequence: number }>((resolve) => {
        finish = resolve;
      });
      const close = vi.fn(async () => {});
      factories.persistence.mockResolvedValue({
        authorityPort: {},
        threadId: 2,
        proxy: { identity: {}, limits: {} },
        whenExited: pending,
        whenFailed: pending,
        close,
      });
      factories.authority.mockResolvedValue({
        threadId: 3,
        whenExited: pending,
        whenFailed: pending,
        stop: () => saving,
        close: vi.fn(async () => {}),
      });
      const runtime = await createNodeServerRuntime({ ...options, stopDeadlineMs: 10 });
      const deadline = expect(runtime.stop()).rejects.toThrow('did not stop within 10 ms');
      await vi.advanceTimersByTimeAsync(11);
      await deadline;
      expect(runtime.state).toBe('stopping');
      expect(close).not.toHaveBeenCalled();
      finish({ status: 'stopped', durableCommitSequence: 8 });
      await expect(runtime.whenStopped()).resolves.toEqual({ status: 'stopped', durableCommitSequence: 8 });
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('存储线程异常传播为失败，清理完成也不能报告durable成功', async () => {
    let fail!: (error: Error) => void;
    const exited = new Promise<never>((_resolve, reject) => {
      fail = reject;
    });
    const close = vi.fn(async () => {});
    factories.persistence.mockResolvedValue({
      authorityPort: {},
      threadId: 2,
      proxy: { identity: {}, limits: {} },
      whenExited: () => exited,
      close,
    });
    factories.authority.mockResolvedValue({
      threadId: 3,
      whenExited: pending,
      whenFailed: pending,
      stop: vi.fn(async () => ({ status: 'stopped', durableCommitSequence: 7 })),
      close: vi.fn(async () => {}),
    });
    const runtime = await createNodeServerRuntime(options);
    fail(new Error('persistence-worker-lost'));
    await expect(runtime.whenStopped()).rejects.toThrow('persistence-worker-lost');
    expect(runtime.state).toBe('failed');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('权威故障立即可见但实际清理未完成时不结算whenStopped或释放写者', async () => {
    let fail!: (error: Error) => void;
    const failed = new Promise<Error>((resolve) => {
      fail = resolve;
    });
    let releaseCleanup!: () => void;
    const cleanup = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    const close = vi.fn(async () => {});
    const error = new Error('authority-control-lost');
    factories.persistence.mockResolvedValue({
      authorityPort: {},
      threadId: 2,
      proxy: { identity: {}, limits: {} },
      whenExited: pending,
      whenFailed: pending,
      close,
    });
    factories.authority.mockResolvedValue({
      threadId: 3,
      whenExited: pending,
      whenFailed: () => failed,
      stop: async () => {
        await cleanup;
        throw error;
      },
      close: vi.fn(async () => {}),
    });
    const runtime = await createNodeServerRuntime(options);
    let settled = false;
    void runtime
      .whenStopped()
      .finally(() => {
        settled = true;
      })
      .catch(() => {});
    fail(error);
    await expect(runtime.whenFailed()).resolves.toBe(error);
    expect(runtime.state).toBe('failed');
    expect(settled).toBe(false);
    expect(close).not.toHaveBeenCalled();
    releaseCleanup();
    await expect(runtime.whenStopped()).rejects.toThrow('authority-control-lost');
    expect(close).toHaveBeenCalledTimes(1);
  });
});
