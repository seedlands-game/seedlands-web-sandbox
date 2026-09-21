import { expect, it } from 'vitest';
import {
  Inventory,
  craftRecipe,
  getVoxelGameplayDefinition,
  getItemDefinition,
} from '../../../../fixtures/classic/content';

it('砂岩与石砖作为新建材：合成消耗正确、可放置、镐可采并掉落自身', () => {
  const sandstone = getItemDefinition('sandstone');
  expect(sandstone.itemType).toBe('block');
  expect(sandstone.placesVoxel).toBe(24);
  const stoneBricks = getItemDefinition('stone-bricks');
  expect(stoneBricks.placesVoxel).toBe(25);

  const bag = new Inventory(36);
  const count = (id: string) => bag.snapshot().reduce((sum, item) => sum + (item?.itemId === id ? item.count : 0), 0);
  bag.add({ itemId: 'sand-block', count: 4 });
  expect(craftRecipe(bag, 'sandstone')).toMatchObject({ success: true });
  expect(count('sand-block')).toBe(0);
  expect(count('sandstone')).toBe(1);

  bag.add({ itemId: 'stone-block', count: 4 });
  expect(craftRecipe(bag, 'stone-bricks')).toMatchObject({ success: true });
  expect(count('stone-block')).toBe(0);
  expect(count('stone-bricks')).toBe(4);

  for (const [voxel, drop] of [
    [24, 'sandstone'],
    [25, 'stone-bricks'],
  ] as const) {
    const block = getVoxelGameplayDefinition(voxel);
    expect(block.preferredTool).toBe('pickaxe');
    expect(block.minimumTier).toBe(1);
    expect(block.drop).toEqual({ itemId: drop, count: 1 });
  }
});
