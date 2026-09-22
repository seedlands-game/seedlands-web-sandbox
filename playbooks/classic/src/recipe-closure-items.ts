import type { ItemDefinitionInput } from '@seedlands/stdlib/mod-api';

export const woolColors = [
  ['white', '白色'],
  ['orange', '橙色'],
  ['magenta', '品红色'],
  ['light-blue', '淡蓝色'],
  ['yellow', '黄色'],
  ['lime', '黄绿色'],
  ['pink', '粉红色'],
  ['gray', '灰色'],
  ['light-gray', '淡灰色'],
  ['cyan', '青色'],
  ['purple', '紫色'],
  ['blue', '蓝色'],
  ['brown', '棕色'],
  ['green', '绿色'],
  ['red', '红色'],
  ['black', '黑色'],
] as const;

export const recipeClosureItems: readonly ItemDefinitionInput[] = [
  ...(
    [
      ['slab', '半砖', 49],
      ['wood-stairs', '木楼梯', 50],
      ['cobblestone-stairs', '圆石楼梯', 51],
      ['ladder', '梯子', 53],
      ['torch', '火把', 54],
      ['fence', '栅栏', 57],
    ] as const
  ).map(([id, name, voxel]) => ({
    id,
    name,
    itemType: 'block' as const,
    stackLimit: 64,
    capabilities: [{ type: 'place' as const, voxel }],
  })),
  {
    id: 'sandstone-slab',
    name: '砂岩半砖',
    itemType: 'block',
    stackLimit: 64,
    capabilities: [{ type: 'place', voxel: 49 }],
  },
  { id: 'wood-slab', name: '木半砖', itemType: 'block', stackLimit: 64, capabilities: [{ type: 'place', voxel: 49 }] },
  ...woolColors.map(([id, name]) => ({
    id: `${id}-wool`,
    name: `${name}羊毛`,
    itemType: 'resource' as const,
    stackLimit: 64,
    capabilities: [],
  })),
];
