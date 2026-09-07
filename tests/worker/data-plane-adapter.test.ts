import { expect, it } from 'vitest';
import { worldKernelAdapter } from '../../apps/web/src/worker/world-kernel-adapter';
import { makeChunkStaged } from '../../apps/web/src/compute/chunk-kernel';
import { createHaloStaged } from '../../apps/web/src/compute/halo-kernel';
it('uses equivalent TS staged data-plane even when Wasm is off', () => {
  const adapter = worldKernelAdapter({
    memory: null,
    selected: [],
    status: 'off',
    requestedArtifact: 'off',
    effectiveArtifact: 'off',
  });
  expect(adapter.makeChunk).toBe(makeChunkStaged);
  expect(adapter.prepareHalo).toBe(createHaloStaged);
  expect(adapter.now?.()).toEqual(expect.any(Number));
});
