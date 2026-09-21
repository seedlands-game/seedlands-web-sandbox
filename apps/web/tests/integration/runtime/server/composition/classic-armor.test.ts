import { expect, it } from 'vitest';
import { classicContent, getItemDefinition, Inventory, craftRecipe } from '../../../../fixtures/classic/content';
import {
  armorDamageReduction,
  ARMOR_MAX_POINTS,
} from '../../../../../../../packages/stdlib/src/server/gameplay/modules/armor-policy';

const pieces = [
  { id: 'leather-helmet', slot: 'helmet', material: 'leather', points: 1 },
  { id: 'leather-chestplate', slot: 'chestplate', material: 'leather', points: 3 },
  { id: 'iron-helmet', slot: 'helmet', material: 'iron-ingot', points: 2 },
  { id: 'iron-chestplate', slot: 'chestplate', material: 'iron-ingot', points: 6 },
  { id: 'diamond-chestplate', slot: 'chestplate', material: 'diamond', points: 8 },
] as const;

it('护甲物品注册为可穿戴且带防护点数与耐久', () => {
  for (const piece of pieces) {
    const definition = getItemDefinition(piece.id);
    expect(definition.itemType).toBe('armor');
    const armor = classicContent.items.capability(piece.id, 'armor');
    expect(armor).toMatchObject({ type: 'armor', slot: piece.slot, points: piece.points });
    expect(definition.durability?.max).toBeGreaterThan(0);
  }
});

it('护甲按点数线性减伤，封顶且不为负，空护甲不减伤', () => {
  // Minecraft-style: each point reduces 4% of incoming damage.
  expect(armorDamageReduction(10, 0)).toBe(10);
  expect(armorDamageReduction(10, 5)).toBeCloseTo(10 * (1 - (5 * 4) / 100), 6);
  // Cap at ARMOR_MAX_POINTS (20 → 80% reduction).
  expect(armorDamageReduction(10, 100)).toBeCloseTo(10 * (1 - (ARMOR_MAX_POINTS * 4) / 100), 6);
  // Never negative or above incoming.
  expect(armorDamageReduction(0, 10)).toBe(0);
  expect(() => armorDamageReduction(-1, 5)).toThrow();
  expect(() => armorDamageReduction(10, -1)).toThrow();
});

it('全套铁甲由铁锭合成，头盔 5 锭、胸甲 8 锭并带耐久', () => {
  const bag = new Inventory(36);
  bag.add({ itemId: 'iron-ingot', count: 5 });
  expect(craftRecipe(bag, 'iron-helmet')).toMatchObject({ success: true });
  expect(bag.snapshot().some((s) => s?.itemId === 'iron-helmet')).toBe(true);

  const bag2 = new Inventory(36);
  bag2.add({ itemId: 'iron-ingot', count: 7 });
  expect(craftRecipe(bag2, 'iron-chestplate')).toMatchObject({ success: false });
  bag2.add({ itemId: 'iron-ingot', count: 1 });
  expect(craftRecipe(bag2, 'iron-chestplate')).toMatchObject({ success: true });
});
