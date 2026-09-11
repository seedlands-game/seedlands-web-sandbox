import type { ItemStack, StationContentInput, StationRecipe } from '@seedlands/stdlib/mod-api';
const stack = (itemId: string, count = 1): ItemStack => ({ itemId, count });
const pickaxe = (id: string, material: string, durability: number): StationRecipe => ({
  kind: 'shaped',
  id,
  pattern: [stack(material), stack(material), stack(material), null, stack('plank'), null, null, stack('plank'), null],
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
export const overworldStations: StationContentInput = {
  definitions: [
    { kind: 'workbench', voxel: 11 },
    { kind: 'chest', voxel: 12 },
    { kind: 'furnace', voxel: 13 },
  ],
  recipes: [
    pickaxe('wood-pickaxe', 'plank', 60),
    pickaxe('stone-pickaxe', 'stone-block', 132),
    pickaxe('iron-pickaxe', 'iron-ingot', 250),
    ring('chest', 'plank'),
    ring('furnace', 'stone-block'),
  ],
  furnaceRecipes: [{ id: 'smelt-iron', input: stack('raw-iron'), output: stack('iron-ingot'), durationSeconds: 5 }],
  fuels: [
    { itemId: 'coal', burnSeconds: 20 },
    { itemId: 'wood-block', burnSeconds: 8 },
  ],
};
