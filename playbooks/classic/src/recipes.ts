import type { Recipe } from '@seedlands/stdlib/mod-api';

const resourceBlocks: readonly Recipe[] = [
  ['iron-ingot', 'iron-block'],
  ['gold-ingot', 'gold-block'],
  ['diamond', 'diamond-block'],
].flatMap(([material, block]) => [
  { id: block, inputs: [{ itemId: material, count: 9 }], outputs: [{ itemId: block, count: 1 }] },
  { id: block + '-unpack', inputs: [{ itemId: block, count: 1 }], outputs: [{ itemId: material, count: 9 }] },
]);

export const overworldRecipes: readonly Recipe[] = [
  ...resourceBlocks,
  { id: 'planks', inputs: [{ itemId: 'wood-block', count: 1 }], outputs: [{ itemId: 'plank', count: 4 }] },
  { id: 'sticks', inputs: [{ itemId: 'plank', count: 2 }], outputs: [{ itemId: 'stick', count: 4 }] },
  {
    id: 'wood-axe',
    inputs: [
      { itemId: 'plank', count: 3 },
      { itemId: 'stick', count: 2 },
    ],
    outputs: [{ itemId: 'wood-axe', count: 1, instance: { durability: 60 } }],
  },
  {
    id: 'stone-pickaxe',
    inputs: [
      { itemId: 'stick', count: 2 },
      { itemId: 'cobblestone', count: 3 },
    ],
    outputs: [{ itemId: 'stone-pickaxe', count: 1, instance: { durability: 132 } }],
  },
  {
    id: 'wood-sword',
    inputs: [
      { itemId: 'plank', count: 2 },
      { itemId: 'stick', count: 1 },
    ],
    outputs: [{ itemId: 'wood-sword', count: 1 }],
  },
  {
    id: 'lantern',
    inputs: [
      { itemId: 'plank', count: 2 },
      { itemId: 'stone-block', count: 1 },
    ],
    outputs: [{ itemId: 'lantern', count: 1 }],
  },
  { id: 'workbench', inputs: [{ itemId: 'plank', count: 4 }], outputs: [{ itemId: 'workbench', count: 1 }] },
];
