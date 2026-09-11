import { describe, expect, it, vi } from 'vitest';
import { createComputeWorkerEntryLifecycle } from '../../../src/worker/compute-worker-entry-lifecycle';
import type { ComputeTask } from '../../../../../packages/stdlib/src/runtime/compute-task-queue';

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};

const task = (taskId: number, epoch = 'world:1'): ComputeTask => ({
  protocolVersion: 1,
  epoch,
  taskId,
  lane: 'general',
  category: 'mesh',
  priority: 'near',
  key: `mesh:${taskId}`,
  revision: 'r1',
  dependencies: [],
  estimatedBytes: 64,
  payload: {},
});

const cancel = (taskId: number, epoch = 'world:1') => ({
  kind: 'cancel-compute-task' as const,
  protocolVersion: 1 as const,
  epoch,
  taskId,
});

const flushPromises = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('计算 Worker 入口任务生命周期', () => {
  it('忽略未知、错误 epoch 与完成后的取消，不永久保留取消标记', async () => {
    const postMessage = vi.fn();
    const execution = deferred<{ ok: true; result: unknown }>();
    const lifecycle = createComputeWorkerEntryLifecycle({
      postMessage,
      run: () => execution.promise,
    });

    for (let taskId = 1; taskId <= 10_000; taskId += 1) lifecycle.handle(cancel(taskId));
    expect(lifecycle.diagnostics()).toMatchObject({ activeTaskCount: 0, cancelledTaskCount: 0 });

    lifecycle.handle({ kind: 'run-compute-task', task: task(10_001) });
    lifecycle.handle(cancel(10_001, 'world:old'));
    expect(lifecycle.diagnostics()).toMatchObject({ activeTaskCount: 1, cancelledTaskCount: 0 });
    execution.resolve({ ok: true, result: { ok: true } });
    await flushPromises();
    lifecycle.handle(cancel(10_001));

    expect(postMessage).toHaveBeenCalledOnce();
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'compute-result', epoch: 'world:1', taskId: 10_001, ok: true }),
      [],
    );
    expect(lifecycle.diagnostics()).toMatchObject({ activeTaskCount: 0, cancelledTaskCount: 0 });
  });

  it('运行中取消始终返回一次 cancelled 结果并释放活动任务', async () => {
    const postMessage = vi.fn();
    const execution = deferred<{ ok: true; result: unknown }>();
    const lifecycle = createComputeWorkerEntryLifecycle({
      postMessage,
      run: () => execution.promise,
    });

    lifecycle.handle({ kind: 'run-compute-task', task: task(1) });
    lifecycle.handle(cancel(1));
    lifecycle.handle(cancel(1));
    expect(lifecycle.diagnostics()).toMatchObject({ activeTaskCount: 1, cancelledTaskCount: 1 });
    execution.resolve({ ok: true, result: { shouldNotEscape: true } });
    await flushPromises();

    expect(postMessage).toHaveBeenCalledOnce();
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ taskId: 1, ok: false, error: 'cancelled' }), []);
    expect(lifecycle.diagnostics()).toMatchObject({ activeTaskCount: 0, cancelledTaskCount: 0 });
  });

  it('失败后释放任务，且运行中和迟到的重复请求都不重复执行或回执', async () => {
    const postMessage = vi.fn();
    const execution = deferred<{ ok: true; result: unknown }>();
    const run = vi.fn(() => execution.promise);
    const lifecycle = createComputeWorkerEntryLifecycle({ postMessage, run });

    const request = { kind: 'run-compute-task' as const, task: task(3) };
    lifecycle.handle(request);
    lifecycle.handle(request);
    execution.reject(new Error('compute failed'));
    await flushPromises();
    lifecycle.handle(request);
    lifecycle.handle(cancel(3));

    expect(run).toHaveBeenCalledOnce();
    expect(postMessage).toHaveBeenCalledOnce();
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 3, ok: false, error: 'compute failed' }),
      [],
    );
    expect(lifecycle.diagnostics()).toMatchObject({ activeTaskCount: 0, cancelledTaskCount: 0 });
  });

  it('dispose 清空活动和取消状态，迟到完成不得再产生结果', async () => {
    const postMessage = vi.fn();
    const execution = deferred<{ ok: true; result: unknown }>();
    const lifecycle = createComputeWorkerEntryLifecycle({
      postMessage,
      run: () => execution.promise,
    });
    lifecycle.handle({ kind: 'run-compute-task', task: task(1) });
    lifecycle.handle(cancel(1));

    lifecycle.dispose();
    expect(lifecycle.diagnostics()).toMatchObject({
      activeTaskCount: 0,
      cancelledTaskCount: 0,
      disposed: true,
    });
    execution.resolve({ ok: true, result: { late: true } });
    await flushPromises();
    lifecycle.handle({ kind: 'run-compute-task', task: task(2) });

    expect(postMessage).not.toHaveBeenCalled();
  });

  it('大量完成任务只保留固定大小的近期去重窗口', async () => {
    const postMessage = vi.fn();
    const lifecycle = createComputeWorkerEntryLifecycle({
      postMessage,
      run: async (entry) => ({ ok: true, result: entry.taskId }),
    });

    for (let taskId = 1; taskId <= 300; taskId += 1) {
      lifecycle.handle({ kind: 'run-compute-task', task: task(taskId) });
      await flushPromises();
    }

    expect(postMessage).toHaveBeenCalledTimes(300);
    expect(lifecycle.diagnostics()).toMatchObject({
      activeTaskCount: 0,
      cancelledTaskCount: 0,
      recentlySettledTaskCount: 256,
      recentlySettledLimit: 256,
    });
  });
});
