import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { runNodeServerLifecycle } from '../../src/node/server/node-server-lifecycle';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function fixture() {
  const signals = new EventEmitter();
  const terminal = deferred<{ durableCommitSequence: number }>();
  const runtime = {
    epoch: 'cli-test',
    authorityThreadId: 1,
    persistenceThreadId: 2,
    authority: { readDiagnostics: vi.fn(async () => ({ host: { durableCommitSequence: 3 } })) },
    stop: vi.fn(async () => {
      terminal.resolve({ durableCommitSequence: 4 });
      return { durableCommitSequence: 4 };
    }),
    whenStopped: () => terminal.promise,
    whenFailed: () => new Promise<Error>(() => {}),
  };
  const emit = vi.fn();
  const stopFailure = vi.fn();
  return { runtime, signals, emit, stopFailure, terminal };
}

describe('Node CLI 启动与信号生命周期', () => {
  it('启动未完成时记住关停意图，创建完成立即排空且不宣布 ready', async () => {
    const f = fixture();
    const startup = deferred<typeof f.runtime>();
    const running = runNodeServerLifecycle(() => startup.promise, { ...f, computeMode: 'worker-thread' });
    f.signals.emit('SIGTERM');
    startup.resolve(f.runtime);
    await running;
    expect(f.runtime.stop).toHaveBeenCalledTimes(1);
    expect(f.runtime.authority.readDiagnostics).not.toHaveBeenCalled();
    expect(f.emit.mock.calls).toEqual([[{ kind: 'stopped', durableCommitSequence: 4 }]]);
    expect(f.signals.listenerCount('SIGTERM')).toBe(0);
  });

  it('诊断在途收到信号时禁止迟到 ready，重复信号不重复 stop', async () => {
    const f = fixture();
    const diagnostics = deferred<{ host: { durableCommitSequence: number } }>();
    f.runtime.authority.readDiagnostics.mockImplementation(() => diagnostics.promise);
    const running = runNodeServerLifecycle(async () => f.runtime, { ...f, computeMode: 'worker-thread' });
    await Promise.resolve();
    f.signals.emit('SIGTERM');
    f.signals.emit('SIGINT');
    diagnostics.resolve({ host: { durableCommitSequence: 3 } });
    await running;
    expect(f.runtime.stop).toHaveBeenCalledTimes(1);
    expect(f.emit.mock.calls).toEqual([[{ kind: 'stopped', durableCommitSequence: 4 }]]);
  });

  it('正常 ready 后等待真实持久化结果才输出 stopped', async () => {
    const f = fixture();
    const finished = deferred<{ durableCommitSequence: number }>();
    f.runtime.stop.mockImplementation(() => finished.promise);
    const running = runNodeServerLifecycle(async () => f.runtime, { ...f, computeMode: 'child-process' });
    await vi.waitFor(() => expect(f.emit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ready' })));
    f.signals.emit('SIGTERM');
    expect(f.emit.mock.calls).toHaveLength(1);
    finished.resolve({ durableCommitSequence: 6 });
    f.terminal.resolve({ durableCommitSequence: 6 });
    await running;
    expect(f.emit).toHaveBeenLastCalledWith({ kind: 'stopped', durableCommitSequence: 6 });
  });

  it('启动失败仍清掉信号监听，不宣称 ready 或 stopped', async () => {
    const f = fixture();
    await expect(
      runNodeServerLifecycle(
        async () => {
          throw new Error('startup-failed');
        },
        {
          ...f,
          computeMode: 'worker-thread',
        },
      ),
    ).rejects.toThrow('startup-failed');
    expect(f.emit).not.toHaveBeenCalled();
    expect(f.signals.listenerCount('SIGINT')).toBe(0);
  });
});
