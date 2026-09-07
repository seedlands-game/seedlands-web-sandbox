import { expect, it } from 'vitest';
import { worldKernelAdapter } from '../../apps/web/src/worker/world-kernel-adapter';
import { makeChunkStaged } from '../../apps/web/src/compute/chunk-kernel';
import { createHaloStaged } from '../../apps/web/src/compute/halo-kernel';
import { runWorldComputeTask } from '../../packages/game-core/src/compute/world-compute-task';
import { CHUNK_SIZE, Voxel } from '../../packages/game-core/src/world/voxel';

it('uses the TS data-plane and a real monotonic clock when Wasm is off', async () => {
  const adapter = worldKernelAdapter({
    memory: null,
    selected: [],
    status: 'off',
    requestedArtifact: 'off',
    effectiveArtifact: 'off',
  });
  expect(adapter.makeChunk).toBe(makeChunkStaged);
  expect(adapter.prepareHalo).toBe(createHaloStaged);
  const canonical = new Uint16Array(CHUNK_SIZE ** 3);
  canonical[0] = Voxel.Stone;
  const result = await runWorldComputeTask(
    {
      kind: 'generate-mesh',
      traceId: 'web-ts-adapter',
      epoch: 1,
      chunkKey: '0,0,0',
      seed: 7,
      cx: 0,
      cy: 0,
      cz: 0,
      chunkRevision: 0,
      haloRevision: 'pending',
      generatorVersion: 3,
      canonical: canonical.buffer,
      fluid: new Uint8Array(CHUNK_SIZE ** 3).buffer,
      overlays: [],
    },
    () => false,
    () => Promise.resolve(),
    adapter,
  );
  expect(result.kind).toBe('mesh-result');
  if (result.kind !== 'mesh-result') throw new Error('Web TS adapter did not produce a mesh result.');
  expect(result.meshes.length).toBeGreaterThan(0);
});
