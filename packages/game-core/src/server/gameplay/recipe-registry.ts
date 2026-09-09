import { Inventory, type InventoryAccess } from './inventory';
import { ItemIds, assertItemStack, type ItemStack } from './item-registry';

export type Recipe = Readonly<{
  id: string;
  inputs: readonly Readonly<ItemStack>[];
  outputs: readonly Readonly<ItemStack>[];
}>;

export type RecipeRegistry = Readonly<{
  get: (id: string) => Recipe | undefined;
  list: () => readonly Recipe[];
}>;

export function createRecipeRegistry(inputs: readonly Recipe[]): RecipeRegistry {
  const registered = new Map<string, Recipe>();
  for (const source of inputs) {
    if (!source.id?.trim() || registered.has(source.id)) throw new TypeError(`Duplicate or empty recipe: ${source.id}`);
    if (
      !Array.isArray(source.inputs) ||
      source.inputs.length === 0 ||
      !Array.isArray(source.outputs) ||
      source.outputs.length === 0
    )
      throw new TypeError(`Recipe inputs and outputs are required: ${source.id}`);
    const freezeStacks = (stacks: readonly Readonly<ItemStack>[], side: string) => {
      const seen = new Set<string>();
      return Object.freeze(
        stacks.map((stack) => {
          assertItemStack(stack);
          if (seen.has(stack.itemId))
            throw new TypeError(`Duplicate ${side} item in recipe ${source.id}: ${stack.itemId}`);
          seen.add(stack.itemId);
          return Object.freeze({ ...stack });
        }),
      );
    };
    registered.set(
      source.id,
      Object.freeze({
        id: source.id,
        inputs: freezeStacks(source.inputs, 'input'),
        outputs: freezeStacks(source.outputs, 'output'),
      }),
    );
  }
  const values = Object.freeze([...registered.values()]);
  return Object.freeze({ get: (id: string) => registered.get(id), list: () => values });
}

const registry = createRecipeRegistry([
  { id: 'planks', inputs: [{ itemId: ItemIds.WoodBlock, count: 1 }], outputs: [{ itemId: ItemIds.Plank, count: 4 }] },
  { id: 'wood-axe', inputs: [{ itemId: ItemIds.Plank, count: 3 }], outputs: [{ itemId: ItemIds.WoodAxe, count: 1 }] },
  {
    id: 'stone-pickaxe',
    inputs: [
      { itemId: ItemIds.Plank, count: 2 },
      { itemId: ItemIds.StoneBlock, count: 3 },
    ],
    outputs: [{ itemId: ItemIds.StonePickaxe, count: 1 }],
  },
  {
    id: 'wood-sword',
    inputs: [{ itemId: ItemIds.Plank, count: 2 }],
    outputs: [{ itemId: ItemIds.WoodSword, count: 1 }],
  },
  {
    id: 'lantern',
    inputs: [
      { itemId: ItemIds.Plank, count: 2 },
      { itemId: ItemIds.StoneBlock, count: 1 },
    ],
    outputs: [{ itemId: ItemIds.Lantern, count: 1 }],
  },
]);

export function getRecipe(id: string): Recipe {
  const recipe = registry.get(id);
  if (!recipe) throw new RangeError(`Unknown recipe: ${id}`);
  return recipe;
}

export const listRecipes = (): readonly Recipe[] => registry.list();

export const listCraftableRecipes = (inventory: InventoryAccess): readonly Recipe[] =>
  registry
    .list()
    .filter(
      (recipe) =>
        recipe.inputs.every((stack) => inventory.contains(stack)) &&
        recipe.outputs.every((stack) => inventory.canAdd(stack)),
    );

export function craftRecipe(
  inventory: InventoryAccess,
  recipeId: string,
):
  | { success: true; recipe: Recipe }
  | { success: false; reason: 'unknown-recipe' | 'missing-inputs' | 'no-output-capacity' } {
  const recipe = registry.get(recipeId);
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
  return { success: true, recipe };
}
