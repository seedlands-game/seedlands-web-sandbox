import type { Recipe } from '@seedlands/stdlib/mod-api';

const resourceBlocks: readonly Recipe[] = [
  ['iron-ingot', 'iron-block'],
  ['gold-ingot', 'gold-block'],
  ['diamond', 'diamond-block'],
].flatMap(([material, block]) => [
  { id: block, inputs: [{ itemId: material, count: 9 }], outputs: [{ itemId: block, count: 1 }] },
  { id: block + '-unpack', inputs: [{ itemId: block, count: 1 }], outputs: [{ itemId: material, count: 9 }] },
]);

const toolTiers: readonly [string, string][] = [
  ['stone', 'cobblestone'],
  ['iron', 'iron-ingot'],
  ['gold', 'gold-ingot'],
  ['diamond', 'diamond'],
];
const toolDurability: Record<string, number> = { stone: 132, iron: 250, gold: 32, diamond: 1561 };
const meleeTools: readonly Recipe[] = toolTiers.flatMap(([tier, material]) => [
  {
    id: tier + '-axe',
    inputs: [
      { itemId: material, count: 3 },
      { itemId: 'stick', count: 2 },
    ],
    outputs: [{ itemId: tier + '-axe', count: 1, instance: { durability: toolDurability[tier] } }],
  },
  {
    id: tier + '-sword',
    inputs: [
      { itemId: material, count: 2 },
      { itemId: 'stick', count: 1 },
    ],
    outputs: [{ itemId: tier + '-sword', count: 1, instance: { durability: toolDurability[tier] } }],
  },
]);

const shovelTiers: readonly [string, string, number][] = [
  ['wood', 'plank', 60],
  ['stone', 'cobblestone', 132],
  ['iron', 'iron-ingot', 250],
  ['gold', 'gold-ingot', 32],
  ['diamond', 'diamond', 1561],
];
const shovelTools: readonly Recipe[] = shovelTiers.map(([tier, material, durability]) => ({
  id: tier + '-shovel',
  inputs: [
    { itemId: material, count: 1 },
    { itemId: 'stick', count: 2 },
  ],
  outputs: [{ itemId: tier + '-shovel', count: 1, instance: { durability } }],
}));

export const overworldRecipes: readonly Recipe[] = [
  ...resourceBlocks,
  ...meleeTools,
  ...shovelTools,
  { id: 'sandstone', inputs: [{ itemId: 'sand-block', count: 4 }], outputs: [{ itemId: 'sandstone', count: 1 }] },
  {
    id: 'stone-bricks',
    inputs: [{ itemId: 'stone-block', count: 4 }],
    outputs: [{ itemId: 'stone-bricks', count: 4 }],
  },
  { id: 'planks', inputs: [{ itemId: 'wood-block', count: 1 }], outputs: [{ itemId: 'plank', count: 4 }] },
  { id: 'bread', inputs: [{ itemId: 'wheat', count: 3 }], outputs: [{ itemId: 'bread', count: 1 }] },
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
