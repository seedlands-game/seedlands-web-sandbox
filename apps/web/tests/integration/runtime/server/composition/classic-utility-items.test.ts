import { expect, it } from 'vitest';
import { getItemDefinition, Inventory, craftRecipe } from '../../../../fixtures/classic/content';

const utilities = [
  { id: 'bowl', inputs: [['plank', 3]], out: 4, durability: false },
  { id: 'bucket', inputs: [['iron-ingot', 3]], out: 1, durability: false },
  { id: 'shears', inputs: [['iron-ingot', 2]], out: 1, durability: 238 },
  { id: 'minecart', inputs: [['iron-ingot', 5]], out: 1, durability: false },
  { id: 'boat', inputs: [['plank', 5]], out: 1, durability: false },
] as const;

it('实用与运输物品注册并按材料合成，消耗与产出守恒', () => {
  for (const u of utilities) {
    const definition = getItemDefinition(u.id);
    expect(definition).toBeDefined();
    const bag = new Inventory(36);
    // one short of each input → fail
    for (const [item, count] of u.inputs) bag.add({ itemId: item, count: count - 1 });
    const before = bag.snapshot();
    expect(craftRecipe(bag, u.id)).toMatchObject({ success: false });
    expect(bag.snapshot()).toEqual(before);
    for (const [item] of u.inputs) bag.add({ itemId: item, count: 1 });
    expect(craftRecipe(bag, u.id)).toMatchObject({ success: true });
    const made = bag.snapshot().find((s) => s?.itemId === u.id);
    expect(made?.count).toBe(u.out);
    if (u.durability) expect(made?.instance?.durability).toBe(u.durability);
  }
});

it('矿车升级：普通矿车配箱子/熔炉得到对应变体', () => {
  const bag = new Inventory(36);
  bag.add({ itemId: 'minecart', count: 1 });
  bag.add({ itemId: 'chest', count: 1 });
  expect(craftRecipe(bag, 'chest-minecart')).toMatchObject({ success: true });
  expect(bag.snapshot().some((s) => s?.itemId === 'chest-minecart')).toBe(true);

  const bag2 = new Inventory(36);
  bag2.add({ itemId: 'minecart', count: 1 });
  bag2.add({ itemId: 'furnace', count: 1 });
  expect(craftRecipe(bag2, 'furnace-minecart')).toMatchObject({ success: true });
  expect(bag2.snapshot().some((s) => s?.itemId === 'furnace-minecart')).toBe(true);
});
