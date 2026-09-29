import { expect, it } from 'vitest';
import {
  classicContent,
  Inventory,
  craftRecipe,
  getVoxelGameplayDefinition,
} from '../../../../fixtures/classic/content';
import { createMiningToolUseCandidate } from '../../../../../../../packages/stdlib/src/server/gameplay/modules/mining-tool-policy';
import {
  createFurnaceDefinitions,
  advanceFurnaceCandidate,
  emptyFurnaceSnapshot,
} from '../../../../../../../packages/stdlib/src/server/gameplay/modules/furnace-candidates';
import { overworldStations } from '../../../../../../../playbooks/classic/src/stations';

it('金/钻石矿有铁镐门槛，金镐速度不赋予高阶采集能力，耐久归零移除', () => {
  for (const voxel of [19, 20]) {
    const block = getVoxelGameplayDefinition(voxel);
    expect(block.minimumTier).toBe(3);
    expect(() =>
      createMiningToolUseCandidate(
        classicContent.items,
        { itemId: 'stone-pickaxe', count: 1, instance: { durability: 132 } },
        { preferredTool: 'pickaxe', minimumTier: block.minimumTier! },
      ),
    ).toThrow();
    expect(() =>
      createMiningToolUseCandidate(
        classicContent.items,
        { itemId: 'gold-pickaxe', count: 1, instance: { durability: 32 } },
        { preferredTool: 'pickaxe', minimumTier: block.minimumTier! },
      ),
    ).toThrow();
  }
  const worn = createMiningToolUseCandidate(
    classicContent.items,
    { itemId: 'diamond-pickaxe', count: 1, instance: { durability: 1 } },
    { preferredTool: 'pickaxe', minimumTier: 3 },
  );
  expect(worn).toEqual({ multiplier: 8, nextStack: null });
});

it('九资源压缩/拆回守恒，缺料不变；金矿冶炼一件只得一金锭', () => {
  for (const [material, block] of [
    ['iron-ingot', 'iron-block'],
    ['gold-ingot', 'gold-block'],
    ['diamond', 'diamond-block'],
  ] as const) {
    const bag = new Inventory(36);
    bag.add({ itemId: material, count: 8 });
    const before = bag.snapshot();
    expect(craftRecipe(bag, block).success).toBe(false);
    expect(bag.snapshot()).toEqual(before);
    bag.add({ itemId: material, count: 1 });
    expect(craftRecipe(bag, block).success).toBe(true);
    expect(bag.snapshot().filter(Boolean)).toEqual([{ itemId: block, count: 1 }]);
    expect(craftRecipe(bag, block + '-unpack').success).toBe(true);
    expect(bag.snapshot().filter(Boolean)).toEqual([{ itemId: material, count: 9 }]);
  }
  const definitions = createFurnaceDefinitions({
    items: classicContent.items,
    recipes: overworldStations.furnaceRecipes,
    fuels: overworldStations.fuels,
  });
  const done = advanceFurnaceCandidate(
    { ...emptyFurnaceSnapshot(), input: { itemId: 'gold-ore', count: 1 }, fuel: { itemId: 'coal', count: 1 } },
    10,
    definitions,
  );
  expect(done.snapshot.output).toEqual({ itemId: 'gold-ingot', count: 1 });
});
