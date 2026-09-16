import {
  freezeWorldgenProvider,
  worldgenProviderIdentityKey,
  type KernelWorldgenProvider,
} from '@seedlands/kernel/spatial';
import type { ModModule, WorldComposition } from '../composition/contracts';

export const WORLDGEN_PROVIDER_CAPABILITY = 'seedlands:worldgen-provider';
export type StandardWorldgenProvider = KernelWorldgenProvider;

export function defineStandardWorldgenModule(
  input: Readonly<{
    moduleId: string;
    provider: StandardWorldgenProvider;
  }>,
): ModModule {
  const provider = freezeWorldgenProvider(input.provider);
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
