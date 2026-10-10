import {
  freezeWorldgenProvider,
  worldgenProviderIdentityKey,
  type KernelWorldgenProvider,
  type KernelWorldgenSampleInput,
} from '@seedlands/kernel/spatial';
import type { ModModule, WorldComposition } from '../composition/contracts';

export const WORLDGEN_PROVIDER_CAPABILITY = 'seedlands:worldgen-provider';
export type StandardWorldgenProvider = KernelWorldgenProvider &
  Readonly<{
    /** Generated voxels above this Y are empty. Excludes edits, persistence and world height policy. */
    generatedEmptyAboveY?(
      input: Pick<KernelWorldgenSampleInput, 'seed' | 'generatorVersion' | 'x' | 'z'>,
    ): number | null;
  }>;

function freezeStandardWorldgenProvider(source: StandardWorldgenProvider): StandardWorldgenProvider {
  const kernel = freezeWorldgenProvider(source);
  const declared = source.generatedEmptyAboveY;
  if (declared === undefined) return kernel;
  if (typeof declared !== 'function') throw new TypeError('Generated empty-space source port is invalid.');
  return Object.freeze({
    ...kernel,
    generatedEmptyAboveY(input) {
      if (!input || ![input.seed, input.generatorVersion, input.x, input.z].every(Number.isSafeInteger))
        throw new TypeError('Generated empty-space query requires safe integers.');
      if (!kernel.identity.supportedGeneratorVersions.includes(input.generatorVersion)) return null;
      const query = Object.freeze({
        seed: input.seed,
        generatorVersion: input.generatorVersion,
        x: input.x,
        z: input.z,
      });
      const result = declared.call(source, query);
      if (result !== null && !Number.isSafeInteger(result))
        throw new TypeError('Generated empty-space bound must be a safe integer or null.');
      return result;
    },
  });
}

export function defineStandardWorldgenModule(
  input: Readonly<{
    moduleId: string;
    provider: StandardWorldgenProvider;
  }>,
): ModModule {
  const provider = freezeStandardWorldgenProvider(input.provider);
  return Object.freeze({
    descriptor: {
      id: input.moduleId,
      version: '1.0.0',
      provides: [
        {
          id: WORLDGEN_PROVIDER_CAPABILITY,
          version: '1.0.0',
          definitionIdentity: worldgenProviderIdentityKey(provider.identity),
        },
      ],
    },
    register(api) {
      api.provideCapability<StandardWorldgenProvider>(WORLDGEN_PROVIDER_CAPABILITY, provider);
    },
  });
}

export function worldgenProviderForComposition(composition: WorldComposition): StandardWorldgenProvider {
  if (!composition.definitionMap.capabilities.some(({ id }) => id === WORLDGEN_PROVIDER_CAPABILITY))
    throw new Error('Selected Playbook does not provide world generation.');
  return composition.capability<StandardWorldgenProvider>(WORLDGEN_PROVIDER_CAPABILITY);
}
