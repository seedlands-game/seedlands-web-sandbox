import { Inventory } from './inventory';
import { ItemIds, type ItemStack } from './item-registry';

export type Recipe = Readonly<{
  id: string;
  inputs: readonly Readonly<ItemStack>[];
  outputs: readonly Readonly<ItemStack>[];
}>;

const recipes: Readonly<Record<string, Recipe>> = Object.freeze({
  planks: {
    id: 'planks',
    inputs: [{ itemId: ItemIds.WoodBlock, count: 1 }],
    outputs: [{ itemId: ItemIds.Plank, count: 4 }],
  },
  'wood-axe': {
    id: 'wood-axe',
    inputs: [{ itemId: ItemIds.Plank, count: 3 }],
    outputs: [{ itemId: ItemIds.WoodAxe, count: 1 }],
  },
  'stone-pickaxe': {
    id: 'stone-pickaxe',
    inputs: [
      { itemId: ItemIds.Plank, count: 2 },
      { itemId: ItemIds.StoneBlock, count: 3 },
    ],
    outputs: [{ itemId: ItemIds.StonePickaxe, count: 1 }],
  },
});

const cloneRecipe = (recipe: Recipe): Recipe => ({
  id: recipe.id,
  inputs: recipe.inputs.map((stack) => ({ ...stack })),
  outputs: recipe.outputs.map((stack) => ({ ...stack })),
});

export function getRecipe(id: string): Recipe {
  const recipe = recipes[id];
  if (!recipe) throw new RangeError(`Unknown recipe: ${id}`);
  return cloneRecipe(recipe);
}

export const listRecipes = (): readonly Recipe[] => Object.values(recipes).map(cloneRecipe);

export const listCraftableRecipes = (inventory: Inventory): readonly Recipe[] =>
  listRecipes().filter(
    (recipe) =>
      recipe.inputs.every((stack) => inventory.contains(stack)) &&
      recipe.outputs.every((stack) => inventory.canAdd(stack)),
  );

export function craftRecipe(
  inventory: Inventory,
  recipeId: string,
):
  | { success: true; recipe: Recipe }
  | { success: false; reason: 'unknown-recipe' | 'missing-inputs' | 'no-output-capacity' } {
  const recipe = recipes[recipeId];
  if (!recipe) return { success: false, reason: 'unknown-recipe' };
  if (!recipe.inputs.every((stack) => inventory.contains(stack))) return { success: false, reason: 'missing-inputs' };
  if (!recipe.outputs.every((stack) => inventory.canAdd(stack)))
    return { success: false, reason: 'no-output-capacity' };
  const candidate = new Inventory(inventory.capacity, inventory.snapshot());
  recipe.inputs.forEach((stack) => candidate.remove(stack));
  for (const output of recipe.outputs) {
    if (!candidate.add(output)) return { success: false, reason: 'no-output-capacity' };
  }
  inventory.replace(candidate.snapshot());
  return { success: true, recipe: cloneRecipe(recipe) };
}
