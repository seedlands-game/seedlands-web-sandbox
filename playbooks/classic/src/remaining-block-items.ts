import type { ItemDefinitionInput } from '@seedlands/stdlib/mod-api';

export const remainingBlockItems: readonly ItemDefinitionInput[] = (
  [
    ['dead-bush', '枯灌木', 59],
    ['wool-block', '羊毛块', 60],
    ['red-flower', '红花', 61],
    ['red-mushroom', '红蘑菇', 62],
    ['bricks', '砖块', 63],
    ['bookshelf', '书架', 64],
    ['mossy-cobblestone', '苔石', 65],
    ['note-block', '音符盒', 66],
    ['jukebox', '唱片机', 67],
    ['pumpkin', '南瓜', 68],
    ['jack-o-lantern', '南瓜灯', 69],
    ['trapdoor', '活板门', 70],
    ['lit-furnace', '燃烧熔炉', 71],
    ['redstone-ore', '红石矿', 72],
    ['lit-redstone-ore', '发光红石矿', 73],
  ] as const
).map(([id, name, voxel]) => ({
  id,
  name,
  itemType: 'block' as const,
  stackLimit: 64,
  capabilities: [{ type: 'place' as const, voxel }],
}));
