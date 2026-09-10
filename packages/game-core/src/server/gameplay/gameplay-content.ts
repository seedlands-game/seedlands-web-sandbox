import {
  freezeCraftingProvider,
  shapelessCraftingProvider,
  type CraftingProviderV1,
} from './modules/crafting-provider';
import { createStationContent, type StationContent, type StationContentInput } from './station-content';
import { createMeleeDefinitionRegistry, listMeleeDefinitions, type MeleeDefinition } from './combat-runtime';
import {
  createItemDefinitionRegistry,
  defaultItemDefinitionRegistry,
  listItemDefinitions,
  type ItemDefinitionInput,
  type ItemDefinitionRegistry,
} from './item-registry';
import {
  createRecipeRegistry,
  defaultRecipeRegistry,
  listRecipes,
  type Recipe,
  type RecipeRegistry,
} from './recipe-registry';
import {
  createActorProfileRegistry,
  createLegacyActorProfileRegistry,
  type ActorProfileInput,
  type ActorProfileRegistry,
  type StarterEcologyConfigurationInput,
} from './actor-profile';
import {
  overworldActorProfiles,
  overworldDefaultPlayerMeleeDefinitionId,
  overworldStarterEcology,
} from './playbooks/overworld/actors';

export type GameplayContent = Readonly<{
  items: ItemDefinitionRegistry;
  recipes: RecipeRegistry;
  crafting?: CraftingProviderV1 | null;
  stations?: StationContent;
  meleeDefinitions: readonly MeleeDefinition[];
  actorProfiles: ActorProfileRegistry;
}>;

export type GameplayContentInput = Readonly<{
  items: readonly ItemDefinitionInput[];
  recipes: readonly Recipe[];
  crafting?: CraftingProviderV1 | null;
  stations?: StationContentInput;
  meleeDefinitions: readonly MeleeDefinition[];
  actorProfiles?: readonly ActorProfileInput[];
  defaultPlayerMeleeDefinitionId?: string;
  starterEcology?: StarterEcologyConfigurationInput;
}>;

export function createGameplayContent(input: GameplayContentInput): GameplayContent {
  const melee = createMeleeDefinitionRegistry(input.meleeDefinitions);
  const items = createItemDefinitionRegistry(input.items, (id) => melee.get(id) !== undefined);
  const recipes = createRecipeRegistry(input.recipes, items);
  const actorProfiles =
    input.actorProfiles === undefined
      ? createLegacyActorProfileRegistry(items, melee.list())
      : createActorProfileRegistry(
          input.actorProfiles,
          items,
          melee.list(),
          input.defaultPlayerMeleeDefinitionId,
          input.starterEcology,
        );
  return Object.freeze({
    items,
    recipes,
    crafting:
      input.crafting === undefined
        ? shapelessCraftingProvider
        : input.crafting === null
          ? null
          : freezeCraftingProvider(input.crafting),
    meleeDefinitions: melee.list(),
    actorProfiles,
    ...(input.stations ? { stations: createStationContent(input.stations, items) } : {}),
  });
}

export const defaultGameplayContent: GameplayContent = Object.freeze({
  items: defaultItemDefinitionRegistry,
  recipes: defaultRecipeRegistry,
  crafting: shapelessCraftingProvider,
  meleeDefinitions: listMeleeDefinitions(),
  actorProfiles: createActorProfileRegistry(
    overworldActorProfiles,
    defaultItemDefinitionRegistry,
    listMeleeDefinitions(),
    overworldDefaultPlayerMeleeDefinitionId,
    overworldStarterEcology,
  ),
});

/** Temporary compatibility path until the root composition layer supplies the default Pack explicitly. */
export const createFirstPartyGameplayContent = (
  meleeDefinitions: readonly MeleeDefinition[] = listMeleeDefinitions(),
): GameplayContent =>
  createGameplayContent({
    items: listItemDefinitions(),
    recipes: listRecipes(),
    meleeDefinitions,
    actorProfiles: overworldActorProfiles,
    defaultPlayerMeleeDefinitionId: overworldDefaultPlayerMeleeDefinitionId,
    starterEcology: overworldStarterEcology,
  });

export function resolveGameplayContent(
  content?: GameplayContent,
  legacyMeleeDefinitions?: readonly MeleeDefinition[],
): GameplayContent {
  if (content && legacyMeleeDefinitions)
    throw new TypeError('Gameplay content and legacy melee definitions cannot both be supplied.');
  const resolved =
    content ??
    (legacyMeleeDefinitions ? createFirstPartyGameplayContent(legacyMeleeDefinitions) : defaultGameplayContent);
  if (resolved.recipes.items !== resolved.items)
    throw new TypeError('Gameplay content recipe and item registries do not match.');
  if (resolved.stations && resolved.stations.codec.items !== resolved.items)
    throw new TypeError('Station content item registry does not match this world.');
  const melee = createMeleeDefinitionRegistry(resolved.meleeDefinitions);
  for (const item of resolved.items.list()) {
    const capability = resolved.items.capability(item.id, 'melee');
    if (capability && !melee.get(capability.definitionId))
      throw new TypeError(`Item ${item.id} references unknown melee definition: ${capability.definitionId}`);
  }
  const actorProfiles = createActorProfileRegistry(
    resolved.actorProfiles.list(),
    resolved.items,
    melee.list(),
    resolved.actorProfiles.defaultPlayerMeleeDefinitionId ?? undefined,
    resolved.actorProfiles.starterEcology ?? undefined,
  );
  return Object.freeze({
    items: resolved.items,
    recipes: resolved.recipes,
    crafting:
      resolved.crafting === undefined
        ? shapelessCraftingProvider
        : resolved.crafting === null
          ? null
          : freezeCraftingProvider(resolved.crafting),
    meleeDefinitions: melee.list(),
    actorProfiles,
    ...(resolved.stations ? { stations: resolved.stations } : {}),
  });
}
