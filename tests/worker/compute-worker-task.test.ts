import { describe, expect, it } from 'vitest';
import { ComputeTaskCancelled, runWorldComputeTask } from '../../src/worker/world-compute-task';
import { CHUNK_SIZE, Voxel } from '../../src/world/voxel';

describe('general compute worker task', () => {
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

    expect(new Uint16Array(result.canonical)[0]).toBe(Voxel.Stone);
    expect(result.meshes.length).toBeGreaterThan(0);
    expect(result.generatorVersion).toBe(3);
  });
});
