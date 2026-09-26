import { assertGeneratedChunk, worldgenProviderIdentityKey } from '@seedlands/kernel/spatial';
import type { KernelWorldgenProvider } from '@seedlands/kernel/spatial';
import { normalizeSeed } from '@seedlands/stdlib/world/voxel';
import type { PersistenceWorkerConfig } from './persistence-worker-protocol';
import { ProceduralChunkBaseCache } from './procedural-chunk-base-cache';

export function createPersistenceWorldgenCache(
  current: () => PersistenceWorkerConfig | null,
  currentProvider: () => KernelWorldgenProvider | null,
) {
  return new ProceduralChunkBaseCache(({ seedText, generatorVersion, providerIdentity, cx, cy, cz }) => {
    const config = current();
    if (!config || providerIdentity !== worldgenProviderIdentityKey(config.provider))
      throw new Error('Procedural Chunk cache provider identity is stale.');
    const provider = currentProvider();
    if (!provider || worldgenProviderIdentityKey(provider.identity) !== providerIdentity)
      throw new Error('Procedural Chunk cache has no matching executable provider.');
    const expected = {
      provider: provider.identity,
      generatorVersion,
      coordinate: { x: cx, y: cy, z: cz },
      epoch: 0,
      revision: 0,
    };
    const generated = provider.generate({
      seed: normalizeSeed(seedText),
      generatorVersion,
      coordinate: expected.coordinate,
      epoch: 0,
      revision: 0,
    });
    assertGeneratedChunk(expected, generated);
    return generated.voxels.slice();
  });
}
