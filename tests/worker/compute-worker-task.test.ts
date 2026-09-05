import { describe, expect, it } from 'vitest';
import { ComputeTaskCancelled, runWorldComputeTask } from '../../src/worker/world-compute-task';
import { CHUNK_SIZE, Voxel } from '../../src/world/voxel';

describe('general compute worker task', () => {
  it('在通用计算Worker内搜索脚底中心安全出生点', async () => {
    const result = await runWorldComputeTask({
      kind: 'find-safe-spawn',
      seed: 7,
      generatorVersion: 3,
    });

    expect(result.kind).toBe('safe-spawn-result');
    if (result.kind !== 'safe-spawn-result') throw new Error('Unexpected compute result.');
    expect(result.playerBodyPosition[1] % 1).toBe(0);
    expect(result.starterChunks.length).toBeGreaterThan(0);
    expect(result.starterChunks.every((chunk) => chunk.chunkRevision === 0)).toBe(true);
  });

  it('只生成Authority需要的canonical且不在通用Worker提前构造Mesh', async () => {
    const result = await runWorldComputeTask({
      kind: 'generate-canonical',
      seed: 7,
      generatorVersion: 3,
      key: '64,1,0',
      cx: 64,
      cy: 1,
      cz: 0,
    });

    expect(result).toMatchObject({
      kind: 'canonical-result',
      key: '64,1,0',
      chunkRevision: 0,
      generatorVersion: 3,
    });
    if (result.kind !== 'canonical-result') throw new Error('Unexpected compute result.');
    expect(new Uint16Array(result.voxels)).toHaveLength(CHUNK_SIZE ** 3);
    expect(result).not.toHaveProperty('meshes');
  });

  it('在生成/halo/mesh阶段间让出事件循环并消费合作式取消', async () => {
    let checkpoints = 0;
    const payload = {
      kind: 'generate-mesh' as const,
      traceId: 'cancelled',
      epoch: 0,
      chunkKey: '0,0,0',
      seed: 1,
      cx: 0,
      cy: 0,
      cz: 0,
      chunkRevision: 0,
      haloRevision: 'pending',
      generatorVersion: 3,
      overlays: [],
    };

    await expect(
      runWorldComputeTask(
        payload,
        () => checkpoints >= 2,
        async () => {
          checkpoints += 1;
        },
      ),
    ).rejects.toBeInstanceOf(ComputeTaskCancelled);
    expect(checkpoints).toBe(2);
  });

  it('接收Authority副本生成可接纳canonical与批量mesh结果', async () => {
    const canonical = new Uint16Array(CHUNK_SIZE ** 3);
    canonical.fill(Voxel.Air);
    canonical[0] = Voxel.Stone;
    const result = await runWorldComputeTask({
      kind: 'generate-mesh',
      traceId: 'mesh',
      epoch: 0,
      chunkKey: '0,0,0',
      seed: 1,
      cx: 0,
      cy: 0,
      cz: 0,
      chunkRevision: 4,
      haloRevision: 'pending',
      generatorVersion: 3,
      canonical: canonical.buffer,
      fluid: new Uint8Array(CHUNK_SIZE ** 3).buffer,
      overlays: [],
    });

    if (!('canonical' in result)) throw new Error('生成网格任务未返回 canonical 结果。');
    expect(new Uint16Array(result.canonical)[0]).toBe(Voxel.Stone);
    expect(result.meshes.length).toBeGreaterThan(0);
    expect(result.generatorVersion).toBe(3);
  });
});
