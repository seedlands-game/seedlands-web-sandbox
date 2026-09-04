import { describe, expect, it } from 'vitest';
import { createMeshTaskSnapshot, isCurrentMeshTask } from '../../src/client/mesh-task-snapshot';

describe('派生 Worker mesh task snapshot', () => {
  it('复制 canonical 数据与一格 halo，并保留 task、epoch 和 revision 身份', () => {
    const canonical = new Uint16Array([1, 2, 3]);
    const halo = new Uint16Array([4, 5]);
    const task = createMeshTaskSnapshot({
      taskId: 7,
      epoch: 3,
      chunkKey: '0,0,0',
      chunkRevision: 2,
      haloRevision: 'halo-2',
      canonical,
      halo,
    });
    canonical[0] = 9;
    halo[0] = 8;

    expect(task.canonical).toEqual(new Uint16Array([1, 2, 3]));
    expect(task.halo).toEqual(new Uint16Array([4, 5]));
    expect(task.canonical.buffer).not.toBe(canonical.buffer);
    expect(task).toMatchObject({ taskId: 7, epoch: 3, chunkRevision: 2, haloRevision: 'halo-2' });
  });

  it('拒绝编辑、取消或场景迁移后的过期结果', () => {
    const task = createMeshTaskSnapshot({
      taskId: 7,
      epoch: 3,
      chunkKey: '0,0,0',
      chunkRevision: 2,
      haloRevision: 'halo-2',
      canonical: new Uint16Array(1),
      halo: new Uint16Array(1),
    });

    expect(isCurrentMeshTask(task, { taskId: 7, epoch: 3, chunkRevision: 2, haloRevision: 'halo-2' })).toBe(true);
    expect(isCurrentMeshTask(task, { taskId: 7, epoch: 4, chunkRevision: 2, haloRevision: 'halo-2' })).toBe(false);
    expect(isCurrentMeshTask(task, { taskId: 7, epoch: 3, chunkRevision: 3, haloRevision: 'halo-2' })).toBe(false);
  });
});
