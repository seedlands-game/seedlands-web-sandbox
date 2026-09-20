import { expect, it } from 'vitest';
import { Inventory, craftRecipe } from '../../../../fixtures/classic/content';

it('缺木棍不能合成工具，木板合成木棍后只消耗所需材料', () => {
  const bag = new Inventory(36);
  bag.add({ itemId: 'plank', count: 5 });
  const count = (id: string) => bag.snapshot().reduce((sum, item) => sum + (item?.itemId === id ? item.count : 0), 0);
  const before = bag.snapshot();
  expect(craftRecipe(bag, 'wood-axe')).toMatchObject({ success: false });
  expect(bag.snapshot()).toEqual(before);
  expect(craftRecipe(bag, 'sticks')).toMatchObject({ success: true });
  expect(count('plank')).toBe(3);
  expect(count('stick')).toBe(4);
  expect(craftRecipe(bag, 'wood-axe')).toMatchObject({ success: true });
  expect(count('plank')).toBe(0);
  expect(count('stick')).toBe(2);
  expect(count('wood-axe')).toBe(1);
});
