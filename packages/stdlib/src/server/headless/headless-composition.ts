import type { WorldComposition } from '../composition/contracts';
import { gameplayContentForComposition } from '../composition/gameplay-composition';
import { worldgenProviderForComposition } from '../worldgen/standard-worldgen-module';

export function resolveHeadlessComposition(createComposition?: () => WorldComposition) {
  const composition = createComposition?.();
  return {
    composition,
    starterEcology: composition ? gameplayContentForComposition(composition).actorProfiles.starterEcology : null,
    worldgenProvider: composition ? worldgenProviderForComposition(composition) : undefined,
  };
}
