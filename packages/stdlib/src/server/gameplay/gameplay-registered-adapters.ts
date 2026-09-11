import { RegisteredStationRuntime } from './modules/registered-station-runtime';
import type { WorldComposition } from '../composition/contracts';
import { RegisteredInventoryRuntime } from './modules/registered-inventory-runtime';
import { RegisteredCombatRuntime } from './modules/registered-combat-runtime';
import { RegisteredBlockRuntime } from './modules/registered-block-runtime';
import { RegisteredFeedingRuntime } from './modules/registered-feeding-runtime';
import { RegisteredForageRuntime } from './modules/registered-forage-runtime';
import { FORAGE_WORLD_COMPONENT } from './modules/forage-model';

type Options = Omit<
  ConstructorParameters<typeof RegisteredInventoryRuntime>[0] &
    ConstructorParameters<typeof RegisteredCombatRuntime>[0] &
    ConstructorParameters<typeof RegisteredBlockRuntime>[0] &
    ConstructorParameters<typeof RegisteredFeedingRuntime>[0] &
    ConstructorParameters<typeof RegisteredForageRuntime>[0],
  'composition'
> & { composition?: WorldComposition };

/** All adapters share the same host owners and remain unavailable in standalone worlds. */
export function createGameplayRegisteredAdapters(options: Options) {
  if (!options.composition)
    return { inventory: null, combat: null, blocks: null, feeding: null, forage: null, stations: null };
  const composed = { ...options, composition: options.composition };
  return {
    inventory: new RegisteredInventoryRuntime(composed),
    combat: new RegisteredCombatRuntime(composed),
    blocks: new RegisteredBlockRuntime(composed),
    feeding: new RegisteredFeedingRuntime(composed),
    forage: options.composition.registrations.states.some(({ definition }) => definition.id === FORAGE_WORLD_COMPONENT)
      ? new RegisteredForageRuntime(composed)
      : null,
    stations: options.content.stations ? new RegisteredStationRuntime(composed) : null,
  };
}
