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
  it('持续交互任务到来时老的后台任务仍在有限派发次数内运行', () => {
    const queue = new ComputeTaskQueue({ epoch: 'world:1', maxTasks: 8, maxBytes: 1024 });
    queue.enqueue(task({ taskId: 1, key: 'old', priority: 'background' }));
    let selected = false;
    for (let id = 2; id <= 40; id += 1) {
      queue.enqueue(task({ taskId: id, key: `hot:${id}`, priority: 'interaction' }));
      const current = queue.take('general')!;
      queue.complete(current.taskId);
      if (current.taskId === 1) {
        selected = true;
        break;
      }
    }
    expect(selected).toBe(true);
  });

  it('重复任务id与未知依赖不能破坏队列字节计数或永久占据队列', () => {
    const queue = new ComputeTaskQueue({ epoch: 'world:1', maxTasks: 8, maxBytes: 1024 });
    queue.enqueue(task());
    expect(queue.enqueue(task({ key: 'different' })).status).toBe('rejected');
    expect(queue.bytes).toBe(64);
    expect(queue.enqueue(task({ taskId: 2, dependencies: [99] })).status).toBe('rejected');
    expect(queue.size).toBe(1);
  });

  it('完成回执只保留有界历史，已排队依赖不会因历史淘汰失效', () => {
    const queue = new ComputeTaskQueue({ epoch: 'world:1', maxTasks: 8, maxBytes: 1024 });
    queue.enqueue(task({ taskId: 1, key: 'dependency' }));
    queue.take('general');
    queue.enqueue(task({ taskId: 2, key: 'dependent', dependencies: [1], priority: 'background' }));
    queue.complete(1);
    for (let id = 3; id <= 100; id += 1) {
      queue.enqueue(task({ taskId: id, key: 'fluid', lane: 'fluid', category: 'fluid' }));
      queue.complete(queue.take('fluid')!.taskId);
    }
    expect(queue.take('general')?.taskId).toBe(2);
    expect(queue.enqueue(task({ taskId: 101, key: 'expired-dependency', dependencies: [1] })).status).toBe('rejected');
  });

  it('失败依赖级联释放未执行任务并不影响独立任务', () => {
    const queue = new ComputeTaskQueue({ epoch: 'world:1', maxTasks: 8, maxBytes: 1024 });
    queue.enqueue(task({ taskId: 1, key: 'a' }));
    queue.take('general');
    queue.enqueue(task({ taskId: 2, key: 'b', dependencies: [1] }));
    queue.enqueue(task({ taskId: 3, key: 'c', dependencies: [2] }));
    queue.enqueue(task({ taskId: 4, key: 'independent' }));
    expect(queue.fail(1).map((entry) => entry.taskId)).toEqual([2, 3]);
    expect(queue.size).toBe(1);
    expect(queue.bytes).toBe(64);
    expect(queue.take('general')?.taskId).toBe(4);
  });
  it('已有子任务需要的旧revision不会被同key合并悄悄替换', () => {
    const queue = new ComputeTaskQueue({ epoch: 'world:1', maxTasks: 8, maxBytes: 1024 });
    queue.enqueue(task({ taskId: 1, key: 'same' }));
    queue.enqueue(task({ taskId: 2, key: 'dependent', dependencies: [1] }));
    expect(queue.enqueue(task({ taskId: 3, key: 'same', revision: 'r2' })).status).toBe('queued');
    expect(queue.take('general')?.taskId).toBe(1);
    queue.complete(1);
    expect(queue.take('general')?.taskId).toBe(2);
    expect(queue.take('general')?.taskId).toBe(3);
  });
});
