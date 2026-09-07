import { describe, expect, it, vi } from 'vitest';
import { ComputeWorkerPool, type ComputeWorkerPort } from '../../../src/client/compute/compute-worker-pool';
import type { ComputeTask } from '../../../src/runtime/compute-task-queue';

class SettlementWorker implements ComputeWorkerPort {
  onmessage: ComputeWorkerPort['onmessage'] = null;
  onerror: ComputeWorkerPort['onerror'] = null;
  readonly posts: unknown[] = [];
  terminated = false;

  postMessage(message: unknown) {
    if (this.terminated) throw new Error('Task reached a terminated worker.');
    this.posts.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  finish(taskId: number) {
    this.onmessage?.({
      data: { kind: 'compute-result', protocolVersion: 1, epoch: 'session:1', taskId, ok: true, result: {} },
    } as MessageEvent<unknown>);
  }
}

const task = (taskId: number): ComputeTask => ({
  protocolVersion: 1,
  epoch: 'session:1',
  taskId,
  lane: 'general',
  category: 'mesh',
  priority: 'streaming',
  key: `mesh:${taskId}`,
  revision: '1',
  dependencies: [],
  estimatedBytes: 64,
  payload: {},
});

function fixture(callbacks: {
  onFailure?: (task: ComputeTask, error: Error) => void;
  onDrop?: (taskId: number) => void;
}) {
  const workers: SettlementWorker[] = [];
  const pool = new ComputeWorkerPool({
    epoch: 'session:1',
    generalWorkerCount: 1,
    maxTasks: 8,
    maxBytes: 1024,
    createWorker: () => {
      const worker = new SettlementWorker();
      workers.push(worker);
      return worker;
    },
    setTimer: () => 1,
    clearTimer: () => undefined,
    ...callbacks,
  });
  return { pool, workers };
}

describe('完整输入副本的 worker 结算边界', () => {
  it('先终止失败 worker 再通知结算，回调再入不能向旧 worker 投递', () => {
    const states: boolean[] = [];
    const { pool, workers } = fixture({
      onFailure: () => {
        states.push(workers[1]!.terminated);
        pool.enqueue(task(2));
      },
    });
    try {
      pool.enqueue(task(1));
      workers[1]!.onerror?.({ message: 'injected worker failure' } as ErrorEvent);
      expect(states).toEqual([true]);
      expect(workers[1]!.posts).toHaveLength(1);
      expect(pool.diagnostics()).toMatchObject({ queued: 1, running: 0 });
    } finally {
      pool.dispose();
    }
  });

  it.each(['epoch-switch', 'dispose'] as const)('%s 在终止全部运行槽后通知旧任务，并关闭再入准入', (mode) => {
    const observations: Array<{ terminated: boolean; admission: string; targetAdmission: string }> = [];
    let nested = false;
    const { pool, workers } = fixture({
      onDrop: (taskId) => {
        if (taskId !== 1) return;
        observations.push({
          terminated: workers.slice(0, 2).every((worker) => worker.terminated),
          admission: pool.enqueue(task(3)).status,
          targetAdmission: pool.enqueue({ ...task(4), epoch: 'session:2' }).status,
        });
        if (!nested) {
          nested = true;
          pool.switchEpoch('session:nested');
        }
      },
    });
    try {
      pool.enqueue(task(1));
      if (mode === 'epoch-switch') pool.switchEpoch('session:2');
      else pool.dispose();
      expect(observations).toEqual([{ terminated: true, admission: 'rejected', targetAdmission: 'rejected' }]);
      expect(workers[1]!.posts).toHaveLength(1);
      if (mode === 'epoch-switch') expect(pool.enqueue({ ...task(5), epoch: 'session:2' }).status).toBe('queued');
    } finally {
      pool.dispose();
    }
  });

  it('运行中取消不提前报告结算，实际计算回包后仅报告一次', () => {
    const dropped = vi.fn();
    const { pool, workers } = fixture({ onDrop: dropped });
    try {
      pool.enqueue(task(1));
      expect(pool.cancel(1)).toBe(true);
      expect(workers[1]!.posts).toHaveLength(2);
      expect(dropped).not.toHaveBeenCalled();
      workers[1]!.finish(1);
      expect(dropped).toHaveBeenCalledExactlyOnceWith(1, 'cancelled');
      workers[1]!.finish(1);
      expect(dropped).toHaveBeenCalledTimes(1);
    } finally {
      pool.dispose();
    }
  });
});
