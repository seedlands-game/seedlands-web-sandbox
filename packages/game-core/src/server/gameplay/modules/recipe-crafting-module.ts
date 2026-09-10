import type { ModModule } from '../../composition/contracts';
import {
  CRAFTING_CAPABILITY,
  freezeCraftingProvider,
  shapelessCraftingProvider,
  type CraftingProviderV1,
} from './crafting-provider';

export function defineCraftingProviderModule(
  input: Readonly<{
    moduleId: string;
    provider: CraftingProviderV1;
  }>,
): ModModule {
  const provider = freezeCraftingProvider(input.provider);
  return Object.freeze({
    descriptor: {
      id: input.moduleId,
      version: '1.0.0',
      provides: [{ id: CRAFTING_CAPABILITY, version: '1.0.0' }],
    },
    register(api) {
      api.provideCapability(CRAFTING_CAPABILITY, provider);
    },
  } satisfies ModModule);
}

export const defineRecipeCraftingModule = (): ModModule =>
  defineCraftingProviderModule({
    moduleId: 'seedlands:recipe-crafting-module',
    provider: shapelessCraftingProvider,
  });
