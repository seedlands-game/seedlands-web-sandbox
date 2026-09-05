import { describe, expect, it } from 'vitest';
import { ComputeTaskQueue, type ComputeTask } from '../../src/runtime/compute-task-queue';

const task = (overrides: Partial<ComputeTask> = {}): ComputeTask => ({
  protocolVersion: 1,
  epoch: 'world:1',
  taskId: 1,
  lane: 'general',
  category: 'mesh',
  priority: 'streaming',
  key: '0,0,0',
  revision: 'r1',
  dependencies: [],
  estimatedBytes: 64,
  payload: {},
  ...overrides,
});

describe('ComputeTaskQueue', () => {
  it('流体保留槽不领取长 Mesh，通用槽也不领取流体', () => {
    const queue = new ComputeTaskQueue({ epoch: 'world:1', maxTasks: 8, maxBytes: 1_024 });
    queue.enqueue(task());
    queue.enqueue(task({ taskId: 2, lane: 'fluid', category: 'fluid', key: 'fluid:0' }));

    expect(queue.take('fluid')?.category).toBe('fluid');
    expect(queue.take('general')?.category).toBe('mesh');
  });

  it('依赖完成前不占用执行槽', () => {
    const queue = new ComputeTaskQueue({ epoch: 'world:1', maxTasks: 8, maxBytes: 1_024 });
    queue.enqueue(task({ taskId: 10, category: 'chunk-generation', key: 'generation' }));
    queue.enqueue(task({ taskId: 11, key: 'mesh', dependencies: [10] }));

    expect(queue.take('general')?.taskId).toBe(10);
    expect(queue.take('general')).toBeNull();
    queue.complete(10);
    expect(queue.take('general')?.taskId).toBe(11);
  });

  it('合并同 key 的未开始任务并保留最新 revision 和最高优先级', () => {
    const queue = new ComputeTaskQueue({ epoch: 'world:1', maxTasks: 8, maxBytes: 1_024 });
    queue.enqueue(task());

    expect(
      queue.enqueue(task({ taskId: 2, revision: 'r2', priority: 'interaction', estimatedBytes: 80 })),
    ).toMatchObject({ status: 'merged', replacedTaskId: 1 });
    expect(queue.take('general')).toMatchObject({ taskId: 2, revision: 'r2', priority: 'interaction' });
  });

  it('同时限制任务数和排队字节并返回显式背压', () => {
    const queue = new ComputeTaskQueue({ epoch: 'world:1', maxTasks: 1, maxBytes: 100 });

    expect(queue.enqueue(task({ estimatedBytes: 80 })).status).toBe('queued');
    expect(queue.enqueue(task({ taskId: 2, key: 'other', estimatedBytes: 40 }))).toMatchObject({
      status: 'backpressure',
      reason: 'task-and-byte-limit',
    });
  });

  it('取消未开始任务并在世界切换时拒绝旧 epoch', () => {
    const queue = new ComputeTaskQueue({ epoch: 'world:1', maxTasks: 8, maxBytes: 1_024 });
    queue.enqueue(task());
    expect(queue.cancel(1)).toBe(true);
    expect(queue.take('general')).toBeNull();

    queue.switchEpoch('world:2');
    expect(queue.enqueue(task())).toMatchObject({ status: 'rejected', reason: 'wrong-epoch' });
    expect(queue.enqueue(task({ epoch: 'world:2', taskId: 2 }))).toMatchObject({ status: 'queued' });
  });
});
