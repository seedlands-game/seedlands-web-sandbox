import { describe, expect, it, vi } from 'vitest';
import { ComputeWorkerPool, type ComputeWorkerPort } from '../../src/client/compute-worker-pool';
import type { ComputeLane, ComputeTask } from '../../src/runtime/compute-task-queue';

class FakeWorker implements ComputeWorkerPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly posts: unknown[] = [];
  terminated = false;

  postMessage(message: unknown) {
    this.posts.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  finish(epoch: string, taskId: number, result: unknown = {}) {
    this.onmessage?.({
      data: { kind: 'compute-result', protocolVersion: 1, epoch, taskId, ok: true, result },
    } as MessageEvent<unknown>);
  }
}

const task = (taskId: number, lane: ComputeLane, overrides: Partial<ComputeTask> = {}): ComputeTask => ({
  protocolVersion: 1,
  epoch: 'world:1',
  taskId,
  lane,
  category: lane === 'fluid' ? 'fluid' : 'mesh',
  priority: 'streaming',
  key: `${lane}:${taskId}`,
  revision: 'r1',
  dependencies: [],
  estimatedBytes: 64,
  payload: {},
  ...overrides,
});

describe('ComputeWorkerPool', () => {
  it('固定保留一个流体槽且通用槽按配置并行，不让 Mesh 借用流体槽', () => {
    const workers: Array<{ lane: ComputeLane; worker: FakeWorker }> = [];
    const pool = new ComputeWorkerPool({
      epoch: 'world:1',
      generalWorkerCount: 2,
      maxTasks: 8,
      maxBytes: 1_024,
      createWorker: (lane) => {
        const worker = new FakeWorker();
        workers.push({ lane, worker });
        return worker;
      },
    });

    expect(workers.map(({ lane }) => lane)).toEqual(['fluid', 'general', 'general']);
    pool.enqueue(task(1, 'general'));
    pool.enqueue(task(2, 'general'));
    pool.enqueue(task(3, 'general'));
    expect(workers[0].worker.posts).toHaveLength(0);
    expect(workers[1].worker.posts).toHaveLength(1);
    expect(workers[2].worker.posts).toHaveLength(1);

    pool.enqueue(task(4, 'fluid'));
    expect(workers[0].worker.posts).toHaveLength(1);
    workers[1].worker.finish('world:1', 1);
    expect(workers[1].worker.posts).toHaveLength(2);
  });

  it('世界切换先终止全部旧 Worker，拒绝旧 epoch 结果并重建同一成本上限', () => {
    const workers: FakeWorker[] = [];
    const results = vi.fn();
    const pool = new ComputeWorkerPool({
      epoch: 'world:1',
      generalWorkerCount: 1,
      maxTasks: 4,
      maxBytes: 512,
      createWorker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
      onResult: results,
    });
    pool.enqueue(task(1, 'general'));

    pool.switchEpoch('world:2');

    expect(workers.slice(0, 2).every((worker) => worker.terminated)).toBe(true);
    expect(workers).toHaveLength(4);
    workers[3].finish('world:1', 1, { stale: true });
    expect(results).not.toHaveBeenCalled();
    expect(pool.enqueue(task(2, 'general'))).toMatchObject({ status: 'rejected', reason: 'wrong-epoch' });
    expect(pool.enqueue(task(3, 'general', { epoch: 'world:2' })).status).toBe('queued');
  });

  it('队列任务数和字节均有界并报告运行、排队、取消和过期结果', () => {
    const workers: FakeWorker[] = [];
    const pool = new ComputeWorkerPool({
      epoch: 'world:1',
      generalWorkerCount: 1,
      maxTasks: 1,
      maxBytes: 100,
      createWorker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    pool.enqueue(task(1, 'general', { estimatedBytes: 80 }));
    expect(pool.enqueue(task(2, 'general', { estimatedBytes: 80 }))).toMatchObject({
      status: 'queued',
    });
    expect(pool.enqueue(task(3, 'general', { estimatedBytes: 40 }))).toMatchObject({
      status: 'backpressure',
      reason: 'task-and-byte-limit',
    });
    expect(pool.cancel(2)).toBe(true);
    expect(pool.diagnostics()).toMatchObject({ running: 1, queued: 0, queuedBytes: 0, cancellationRequests: 1 });
    workers[1].finish('old-epoch', 1);
    expect(pool.diagnostics().staleResults).toBe(1);
  });

  it('仅允许一到两个通用槽，计算 Worker 总数硬上限为三个', () => {
    const create = () => new FakeWorker();
    expect(
      () =>
        new ComputeWorkerPool({
          epoch: 'world:1',
          generalWorkerCount: 3,
          maxTasks: 1,
          maxBytes: 1,
          createWorker: create,
        }),
    ).toThrow(/generalWorkerCount/);
  });
});
