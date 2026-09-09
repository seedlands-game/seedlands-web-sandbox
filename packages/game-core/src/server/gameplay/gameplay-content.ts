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

export type GameplayContent = Readonly<{
  items: ItemDefinitionRegistry;
  recipes: RecipeRegistry;
  meleeDefinitions: readonly MeleeDefinition[];
}>;

export type GameplayContentInput = Readonly<{
  items: readonly ItemDefinitionInput[];
  recipes: readonly Recipe[];
  meleeDefinitions: readonly MeleeDefinition[];
}>;

export function createGameplayContent(input: GameplayContentInput): GameplayContent {
  const melee = createMeleeDefinitionRegistry(input.meleeDefinitions);
  const items = createItemDefinitionRegistry(input.items, (id) => melee.get(id) !== undefined);
  const recipes = createRecipeRegistry(input.recipes, items);
  return Object.freeze({ items, recipes, meleeDefinitions: melee.list() });
}

export const defaultGameplayContent: GameplayContent = Object.freeze({
  items: defaultItemDefinitionRegistry,
  recipes: defaultRecipeRegistry,
  meleeDefinitions: listMeleeDefinitions(),
});

/** Temporary compatibility path until the root composition layer supplies the default Pack explicitly. */
export const createFirstPartyGameplayContent = (
  meleeDefinitions: readonly MeleeDefinition[] = listMeleeDefinitions(),
): GameplayContent =>
  createGameplayContent({
    items: listItemDefinitions(),
    recipes: listRecipes(),
    meleeDefinitions,
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
  const melee = createMeleeDefinitionRegistry(resolved.meleeDefinitions);
  for (const item of resolved.items.list()) {
    const capability = resolved.items.capability(item.id, 'melee');
    if (capability && !melee.get(capability.definitionId))
      throw new TypeError(`Item ${item.id} references unknown melee definition: ${capability.definitionId}`);
  }
  return Object.freeze({ items: resolved.items, recipes: resolved.recipes, meleeDefinitions: melee.list() });
}
