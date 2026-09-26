import type { ItemDefinitionInput } from '@seedlands/stdlib/mod-api';
import { woolVoxelColors, woolVoxelForColor } from '@seedlands/stdlib/world/wool-colors';

export const woolColors = woolVoxelColors.map(([id, name]) => [id, name] as const);

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
    itemType: 'block' as const,
    stackLimit: 64,
    capabilities: [{ type: 'place' as const, voxel: woolVoxelForColor[id] }],
  })),
];
