import { expect, it } from 'vitest';
import {
  classicContent,
  Inventory,
  craftRecipe,
  getItemDefinition,
  getVoxelGameplayDefinition,
} from '../../../../fixtures/classic/content';
import { Voxel } from '../../../../../../../packages/stdlib/src/world/voxel';
import { tillOutcome } from '../../../../../../../packages/stdlib/src/server/gameplay/modules/till-policy';

const hoeMatrix = [
  { id: 'wood-hoe', material: 'plank', durability: 60 },
  { id: 'stone-hoe', material: 'cobblestone', durability: 132 },
  { id: 'iron-hoe', material: 'iron-ingot', durability: 250 },
  { id: 'gold-hoe', material: 'gold-ingot', durability: 32 },
  { id: 'diamond-hoe', material: 'diamond', durability: 1561 },
] as const;

it('各级锄由两材料两木棍合成，携带 till 能力与耐久', () => {
  for (const hoe of hoeMatrix) {
    const definition = getItemDefinition(hoe.id);
    expect(definition.itemType).toBe('tool');
    const till = classicContent.items.capability(hoe.id, 'till');
    expect(till).toMatchObject({ type: 'till' });
    expect(definition.durability).toEqual({ max: hoe.durability });

    const bag = new Inventory(36);
    bag.add({ itemId: hoe.material, count: 2 });
    const before = bag.snapshot();
    expect(craftRecipe(bag, hoe.id)).toMatchObject({ success: false });
    expect(bag.snapshot()).toEqual(before);
    bag.add({ itemId: 'stick', count: 2 });
    expect(craftRecipe(bag, hoe.id)).toMatchObject({ success: true });
    const made = bag.snapshot().find((slot) => slot?.itemId === hoe.id);
    expect(made).toEqual({ itemId: hoe.id, count: 1, instance: { durability: hoe.durability } });
  }
});

it('锄对泥土/草出耕地并消耗一点耐久，对其他方块拒绝', () => {
  // 耕地体素已注册且不可作为普通掉落挖取门槛
  const farmland = getVoxelGameplayDefinition(Voxel.Farmland);
  expect(farmland.preferredTool).toBe('shovel');

  for (const source of [Voxel.Grass, Voxel.Dirt]) {
    const result = tillOutcome(classicContent.items, source, {
      itemId: 'iron-hoe',
      count: 1,
      instance: { durability: 250 },
    });
    expect(result.toVoxel).toBe(Voxel.Farmland);
    expect(result.nextStack).toEqual({ itemId: 'iron-hoe', count: 1, instance: { durability: 249 } });
  }
  // 耐久归零后移除
  const worn = tillOutcome(classicContent.items, Voxel.Dirt, {
    itemId: 'wood-hoe',
    count: 1,
    instance: { durability: 1 },
  });
  expect(worn.nextStack).toBeNull();
  // 对石头拒绝
  expect(() =>
    tillOutcome(classicContent.items, Voxel.Stone, { itemId: 'iron-hoe', count: 1, instance: { durability: 250 } }),
  ).toThrow();
  // 非锄工具拒绝
  expect(() =>
    tillOutcome(classicContent.items, Voxel.Dirt, { itemId: 'iron-pickaxe', count: 1, instance: { durability: 250 } }),
  ).toThrow();
});
