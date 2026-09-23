import type { ItemStack, StationContentInput, StationRecipe } from '@seedlands/stdlib/mod-api';
import { overworldRecipes } from './recipes';
const stack = (itemId: string, count = 1): ItemStack => ({ itemId, count });
const pickaxe = (id: string, material: string, durability: number): StationRecipe => ({
  kind: 'shaped',
  id,
  pattern: [stack(material), stack(material), stack(material), null, stack('stick'), null, null, stack('stick'), null],
  outputs: [{ itemId: id, count: 1, instance: { durability } }],
});
const ring = (id: string, material: string): StationRecipe => ({
  kind: 'shaped',
  id,
  pattern: [
    stack(material),
    stack(material),
    stack(material),
    stack(material),
    null,
    stack(material),
    stack(material),
    stack(material),
    stack(material),
  ],
  outputs: [stack(id)],
});
const shapedRecipes: readonly StationRecipe[] = [
  pickaxe('wood-pickaxe', 'plank', 60),
  pickaxe('stone-pickaxe', 'cobblestone', 132),
  pickaxe('iron-pickaxe', 'iron-ingot', 250),
  pickaxe('gold-pickaxe', 'gold-ingot', 32),
  pickaxe('diamond-pickaxe', 'diamond', 1561),
  ring('chest', 'plank'),
  ring('furnace', 'cobblestone'),
];
const shapedIds = new Set(shapedRecipes.map((recipe) => recipe.id));

/** One Classic grid recipe catalog is matched by both the personal 2x2 and workbench 3x3 owners. */
export const overworldCraftingRecipes: readonly StationRecipe[] = [
  ...shapedRecipes,
  ...overworldRecipes
    .filter((recipe) => !shapedIds.has(recipe.id))
    .map((recipe) => ({
      kind: 'shapeless' as const,
      id: recipe.id,
      inputs: recipe.inputs.flatMap((input) => Array.from({ length: input.count }, () => ({ ...input, count: 1 }))),
      outputs: recipe.outputs,
    })),
];

export const overworldStations: StationContentInput = {
  definitions: [
    { kind: 'workbench', voxel: 11 },
    { kind: 'chest', voxel: 12 },
    { kind: 'furnace', voxel: 13 },
  ],
  recipes: overworldCraftingRecipes,
  furnaceRecipes: [
    { id: 'smelt-gold', input: stack('gold-ore'), output: stack('gold-ingot'), durationSeconds: 10 },
    { id: 'smelt-iron', input: stack('raw-iron'), output: stack('iron-ingot'), durationSeconds: 10 },
    { id: 'smelt-stone', input: stack('cobblestone'), output: stack('stone-block'), durationSeconds: 10 },
    { id: 'smelt-glass', input: stack('sand-block'), output: stack('glass'), durationSeconds: 10 },
    { id: 'smelt-charcoal', input: stack('wood-block'), output: stack('charcoal'), durationSeconds: 10 },
    { id: 'smelt-brick', input: stack('clay'), output: stack('brick'), durationSeconds: 10 },
    { id: 'smelt-cactus', input: stack('cactus'), output: stack('green-dye'), durationSeconds: 10 },
    { id: 'smelt-diamond', input: stack('diamond-ore'), output: stack('diamond'), durationSeconds: 10 },
    { id: 'cook-porkchop', input: stack('raw-porkchop'), output: stack('cooked-porkchop'), durationSeconds: 10 },
    { id: 'cook-fish', input: stack('raw-fish'), output: stack('cooked-fish'), durationSeconds: 10 },
  ],
  fuels: [
    { itemId: 'coal', burnSeconds: 80 },
    { itemId: 'charcoal', burnSeconds: 80 },
    { itemId: 'wood-block', burnSeconds: 15 },
    { itemId: 'plank', burnSeconds: 15 },
    { itemId: 'stick', burnSeconds: 5 },
  ],
};
