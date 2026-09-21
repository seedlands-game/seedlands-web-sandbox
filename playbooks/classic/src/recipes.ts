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
const hoeTools: readonly Recipe[] = shovelTiers.map(([tier, material, durability]) => ({
  id: tier + '-hoe',
  inputs: [
    { itemId: material, count: 2 },
    { itemId: 'stick', count: 2 },
  ],
  outputs: [{ itemId: tier + '-hoe', count: 1, instance: { durability } }],
}));

const armorTiers: readonly [string, string, number][] = [
  ['leather', 'leather', 55],
  ['iron', 'iron-ingot', 165],
  ['gold', 'gold-ingot', 77],
  ['diamond', 'diamond', 363],
];
const armorPieceCost: Record<string, number> = { helmet: 5, chestplate: 8, leggings: 7, boots: 4 };
const armorRecipes: readonly Recipe[] = armorTiers.flatMap(([tier, material, durability]) =>
  Object.entries(armorPieceCost).map(([slot, count]) => ({
    id: `${tier}-${slot}`,
    inputs: [{ itemId: material, count }],
    outputs: [{ itemId: `${tier}-${slot}`, count: 1, instance: { durability } }],
  })),
);

export const overworldRecipes: readonly Recipe[] = [
  ...resourceBlocks,
  ...meleeTools,
  ...shovelTools,
  ...hoeTools,
  ...armorRecipes,
  { id: 'sandstone', inputs: [{ itemId: 'sand-block', count: 4 }], outputs: [{ itemId: 'sandstone', count: 1 }] },
  {
    id: 'stone-bricks',
    inputs: [{ itemId: 'stone-block', count: 4 }],
    outputs: [{ itemId: 'stone-bricks', count: 4 }],
  },
  { id: 'planks', inputs: [{ itemId: 'wood-block', count: 1 }], outputs: [{ itemId: 'plank', count: 4 }] },
  { id: 'bread', inputs: [{ itemId: 'wheat', count: 3 }], outputs: [{ itemId: 'bread', count: 1 }] },
  { id: 'bowl', inputs: [{ itemId: 'plank', count: 3 }], outputs: [{ itemId: 'bowl', count: 4 }] },
  { id: 'bucket', inputs: [{ itemId: 'iron-ingot', count: 3 }], outputs: [{ itemId: 'bucket', count: 1 }] },
  {
    id: 'shears',
    inputs: [{ itemId: 'iron-ingot', count: 2 }],
    outputs: [{ itemId: 'shears', count: 1, instance: { durability: 238 } }],
  },
  { id: 'minecart', inputs: [{ itemId: 'iron-ingot', count: 5 }], outputs: [{ itemId: 'minecart', count: 1 }] },
  {
    id: 'chest-minecart',
    inputs: [
      { itemId: 'minecart', count: 1 },
      { itemId: 'chest', count: 1 },
    ],
    outputs: [{ itemId: 'chest-minecart', count: 1 }],
  },
  {
    id: 'furnace-minecart',
    inputs: [
      { itemId: 'minecart', count: 1 },
      { itemId: 'furnace', count: 1 },
    ],
    outputs: [{ itemId: 'furnace-minecart', count: 1 }],
  },
  { id: 'boat', inputs: [{ itemId: 'plank', count: 5 }], outputs: [{ itemId: 'boat', count: 1 }] },
  {
    id: 'bed',
    inputs: [
      { itemId: 'plank', count: 3 },
      { itemId: 'wool', count: 3 },
    ],
    outputs: [{ itemId: 'bed', count: 1 }],
  },
  {
    id: 'tnt',
    inputs: [
      { itemId: 'gunpowder', count: 5 },
      { itemId: 'sand-block', count: 4 },
    ],
    outputs: [{ itemId: 'tnt', count: 1 }],
  },
  {
    id: 'bow',
    inputs: [
      { itemId: 'stick', count: 3 },
      { itemId: 'string', count: 3 },
    ],
    outputs: [{ itemId: 'bow', count: 1, instance: { durability: 384 } }],
  },
  {
    id: 'arrows',
    inputs: [
      { itemId: 'flint', count: 1 },
      { itemId: 'stick', count: 1 },
      { itemId: 'feather', count: 1 },
    ],
    outputs: [{ itemId: 'arrow', count: 4 }],
  },
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
