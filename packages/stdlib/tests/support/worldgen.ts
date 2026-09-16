import {
  createWorldgenProviderRegistry,
  type KernelWorldgenProvider,
  type KernelWorldgenProviderIdentity,
} from '@seedlands/kernel/spatial';
import { makeChunk } from '../../src/world/chunk-generation';
import { macroAt } from '../../src/world/macro-world';
import { baseVoxel } from '../../src/world/voxel';
export const testWorldgenProvider: KernelWorldgenProviderIdentity = Object.freeze({
  id: 'test:worldgen',
  implementationVersion: '1.0.0',
  configurationIdentity: 'test',
  supportedGeneratorVersions: Object.freeze([2, 3, 4]),
  artifactIdentity: 'test:fixture@1',
});

export const testWorldgenExecutableProvider: KernelWorldgenProvider = Object.freeze({
  identity: testWorldgenProvider,
  generate({ seed, generatorVersion, coordinate, epoch, revision }) {
    return {
      coordinate,
      provider: testWorldgenProvider,
      generatorVersion,
      epoch,
      revision,
      voxels: makeChunk(seed, coordinate.x, coordinate.y, coordinate.z, [], generatorVersion),
    };
  },
  sampleVoxel({ seed, generatorVersion, x, y, z }) {
    const queryMacro = (qx: number, qz: number) => macroAt(seed, qx, qz, generatorVersion);
    return baseVoxel(seed, x, y, z, queryMacro(x, z), queryMacro, generatorVersion);
  },
});

export const testWorldgenProviders = createWorldgenProviderRegistry([testWorldgenExecutableProvider]);
