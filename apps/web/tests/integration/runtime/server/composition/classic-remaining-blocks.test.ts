import { expect, it } from 'vitest';
import { classicContent } from '../../../../fixtures/classic/content';
import { Voxel } from '@seedlands/stdlib/world/voxel';

it('剩余主世界方块均有内容、掉落与可放置物闭包', () => {
  const ids = [
    ['dead-bush', Voxel.DeadBush],
    ['wool-block', Voxel.Wool],
    ['red-flower', Voxel.RedFlower],
    ['red-mushroom', Voxel.RedMushroom],
    ['bricks', Voxel.Bricks],
    ['bookshelf', Voxel.Bookshelf],
    ['mossy-cobblestone', Voxel.MossyCobblestone],
    ['note-block', Voxel.NoteBlock],
    ['jukebox', Voxel.Jukebox],
    ['pumpkin', Voxel.Pumpkin],
    ['jack-o-lantern', Voxel.JackOLantern],
    ['trapdoor', Voxel.Trapdoor],
  ] as const;
  for (const [id, voxel] of ids) {
    expect(classicContent.items.require(id).placesVoxel).toBe(voxel);
    expect(classicContent.voxelGameplay.require(voxel).voxel).toBe(voxel);
  }
  for (const id of ['bricks', 'bookshelf', 'note-block', 'jukebox', 'jack-o-lantern', 'trapdoor'])
    expect(classicContent.recipes.get(id)?.id).toBe(id);
});

it('红石矿与燃烧熔炉有独立体素和明确掉落规则', () => {
  expect(classicContent.voxelGameplay.require(Voxel.RedstoneOre).drop).toEqual({ itemId: 'redstone-dust', count: 4 });
  expect(classicContent.voxelGameplay.require(Voxel.LitRedstoneOre).drop).toEqual({
    itemId: 'redstone-dust',
    count: 4,
  });
  expect(classicContent.voxelGameplay.require(Voxel.LitFurnace).drop).toEqual({ itemId: 'furnace', count: 1 });
});
