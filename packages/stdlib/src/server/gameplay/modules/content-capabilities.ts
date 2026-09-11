import type { ModRegistrationFacade } from '../../composition/contracts';
import type { ActorProfileRegistry } from '../actor-profile';
import type { MeleeDefinition } from '../combat-runtime';
import type { GameplayContent } from '../gameplay-content';
import type { ItemDefinitionRegistry } from '../item-registry';
import type { RecipeRegistry } from '../recipe-registry';
import type { StationContent } from '../station-content';
import type { CraftingProviderV1 } from './crafting-provider';
import { createVoxelGameplayRegistry } from '../voxel-gameplay';

export const ITEMS_CAPABILITY = 'seedlands:items';
export const RECIPES_CAPABILITY = 'seedlands:recipes';
export const ACTOR_PROFILES_CAPABILITY = 'seedlands:actor-profiles';
export const MELEE_DEFINITIONS_CAPABILITY = 'seedlands:melee-definitions';
export const STATION_CONTENT_CAPABILITY = 'seedlands:station-content';
export const CONTENT_CRAFTING_CAPABILITY = 'seedlands:content-crafting';

export const GAMEPLAY_CONTENT_CAPABILITIES = Object.freeze([
  ITEMS_CAPABILITY,
  RECIPES_CAPABILITY,
  ACTOR_PROFILES_CAPABILITY,
  MELEE_DEFINITIONS_CAPABILITY,
  STATION_CONTENT_CAPABILITY,
  CONTENT_CRAFTING_CAPABILITY,
]);

const assemble = (read: <Value>(id: string) => Value): GameplayContent => {
  const items = read<ItemDefinitionRegistry>(ITEMS_CAPABILITY);
  const recipes = read<RecipeRegistry>(RECIPES_CAPABILITY);
  const actorProfiles = read<ActorProfileRegistry>(ACTOR_PROFILES_CAPABILITY);
  const meleeDefinitions = read<readonly MeleeDefinition[]>(MELEE_DEFINITIONS_CAPABILITY);
  const stations = read<StationContent | null>(STATION_CONTENT_CAPABILITY);
  const crafting = read<CraftingProviderV1 | null>(CONTENT_CRAFTING_CAPABILITY);
  return Object.freeze({
    items,
    recipes,
    actorProfiles,
    meleeDefinitions,
    crafting,
    voxelGameplay: createVoxelGameplayRegistry(),
    ...(stations ? { stations } : {}),
  });
};

export const gameplayContentFromComposition = (
  composition: Readonly<{ capability<Value>(id: string): Value }>,
): GameplayContent => {
  const content = assemble((id) => composition.capability(id));
  if (content.recipes.items !== content.items)
    throw new TypeError('Recipe and item capability registries do not match.');
  if (content.stations && content.stations.codec.items !== content.items)
    throw new TypeError('Station and item capability registries do not match.');
  return content;
};

export const gameplayContentFromRegistration = (
  api: Pick<ModRegistrationFacade, 'requireCapability'>,
): GameplayContent => assemble((id) => api.requireCapability(id));

export const contentCapabilityContracts = () =>
  GAMEPLAY_CONTENT_CAPABILITIES.map((id) => Object.freeze({ id, version: '1.0.0' }));
