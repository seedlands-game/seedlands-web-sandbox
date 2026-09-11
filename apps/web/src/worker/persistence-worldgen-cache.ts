import {
  assertGeneratedChunk,
  createWorldgenProviderRegistry,
  worldgenProviderIdentityKey,
} from '@seedlands/kernel/spatial';
import { classicWorldgenProvider } from '@seedlands/playbook-classic/worldgen';
import { normalizeSeed } from '@seedlands/stdlib/world/voxel';
import type { PersistenceWorkerConfig } from './persistence-worker-protocol';
import { ProceduralChunkBaseCache } from './procedural-chunk-base-cache';

export const persistenceWorldgenProviders = createWorldgenProviderRegistry([classicWorldgenProvider]);

export function createPersistenceWorldgenCache(
  current: () => PersistenceWorkerConfig | null,
  providers: ReturnType<typeof createWorldgenProviderRegistry>,
) {
  return new ProceduralChunkBaseCache(({ seedText, generatorVersion, providerIdentity, cx, cy, cz }) => {
    const config = current();
    if (!config || providerIdentity !== worldgenProviderIdentityKey(config.provider))
      throw new Error('Procedural Chunk cache provider identity is stale.');
    const provider = providers.resolve(config.provider, generatorVersion);
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
