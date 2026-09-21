import { expect, it } from 'vitest';
import {
  classicContent,
  Inventory,
  craftRecipe,
  getItemDefinition,
  getVoxelGameplayDefinition,
} from '../../../../fixtures/classic/content';
import { createMiningToolUseCandidate } from '../../../../../../../packages/stdlib/src/server/gameplay/modules/mining-tool-policy';

const shovelMatrix = [
  { id: 'wood-shovel', material: 'plank', tier: 1, multiplier: 2, durability: 60 },
  { id: 'stone-shovel', material: 'cobblestone', tier: 2, multiplier: 4, durability: 132 },
  { id: 'iron-shovel', material: 'iron-ingot', tier: 3, multiplier: 6, durability: 250 },
  { id: 'gold-shovel', material: 'gold-ingot', tier: 1, multiplier: 12, durability: 32 },
  { id: 'diamond-shovel', material: 'diamond', tier: 4, multiplier: 8, durability: 1561 },
] as const;

it('各级铲由木棍与对应材料合成，携带 shovel 采集能力与耐久', () => {
  for (const shovel of shovelMatrix) {
    const definition = getItemDefinition(shovel.id);
    expect(definition.itemType).toBe('tool');
    const mine = classicContent.items.capability(shovel.id, 'mine');
    expect(mine).toMatchObject({ type: 'mine', tool: 'shovel', tier: shovel.tier, multiplier: shovel.multiplier });
    expect(definition.durability).toEqual({ max: shovel.durability });

    const bag = new Inventory(36);
    bag.add({ itemId: shovel.material, count: 1 });
    const before = bag.snapshot();
    expect(craftRecipe(bag, shovel.id)).toMatchObject({ success: false });
    expect(bag.snapshot()).toEqual(before);
    bag.add({ itemId: 'stick', count: 2 });
    expect(craftRecipe(bag, shovel.id)).toMatchObject({ success: true });
    const made = bag.snapshot().find((slot) => slot?.itemId === shovel.id);
    expect(made).toEqual({ itemId: shovel.id, count: 1, instance: { durability: shovel.durability } });
  }
});

it('软方块偏好 shovel：徒手可挖但铲更快，铲对石类不给加速', () => {
  for (const voxel of [1, 2, 6]) {
    const block = getVoxelGameplayDefinition(voxel);
    expect(block.preferredTool).toBe('shovel');
    // 徒手（无工具）仍可挖，倍率 1
    expect(
      createMiningToolUseCandidate(classicContent.items, null, {
        preferredTool: 'shovel',
        minimumTier: block.minimumTier ?? 0,
      }),
    ).toEqual({ multiplier: 1, nextStack: null });
    // 铁铲给出其倍率
    const withShovel = createMiningToolUseCandidate(
      classicContent.items,
      { itemId: 'iron-shovel', count: 1, instance: { durability: 250 } },
      { preferredTool: 'shovel', minimumTier: block.minimumTier ?? 0 },
    );
    expect(withShovel.multiplier).toBe(6);
  }
  // 铲挖石头（preferredTool pickaxe, tier1）不满足门槛
  expect(() =>
    createMiningToolUseCandidate(
      classicContent.items,
      { itemId: 'iron-shovel', count: 1, instance: { durability: 250 } },
      { preferredTool: 'pickaxe', minimumTier: 1 },
    ),
  ).toThrow();
});
