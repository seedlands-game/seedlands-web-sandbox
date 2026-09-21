import { expect, it } from 'vitest';
import {
  classicContent,
  Inventory,
  craftRecipe,
  getItemDefinition,
  getMeleeDefinition,
} from '../../../../fixtures/classic/content';
import { createMiningToolUseCandidate } from '../../../../../../../packages/stdlib/src/server/gameplay/modules/mining-tool-policy';

const axeMatrix = [
  { id: 'stone-axe', material: 'cobblestone', tier: 2, multiplier: 4, durability: 132 },
  { id: 'iron-axe', material: 'iron-ingot', tier: 3, multiplier: 6, durability: 250 },
  { id: 'gold-axe', material: 'gold-ingot', tier: 1, multiplier: 12, durability: 32 },
  { id: 'diamond-axe', material: 'diamond', tier: 4, multiplier: 8, durability: 1561 },
] as const;

const swordMatrix = [
  { id: 'stone-sword', material: 'cobblestone', firstDamage: 6 },
  { id: 'iron-sword', material: 'iron-ingot', firstDamage: 7 },
  { id: 'gold-sword', material: 'gold-ingot', firstDamage: 5 },
  { id: 'diamond-sword', material: 'diamond', firstDamage: 8 },
] as const;

it('各级斧头由木棍与对应材料合成，携带正确采集倍率、tier 与耐久', () => {
  for (const axe of axeMatrix) {
    const definition = getItemDefinition(axe.id);
    expect(definition.itemType).toBe('tool');
    const mine = classicContent.items.capability(axe.id, 'mine');
    expect(mine).toMatchObject({ type: 'mine', tool: 'axe', tier: axe.tier, multiplier: axe.multiplier });
    expect(definition.durability).toEqual({ max: axe.durability });

    const bag = new Inventory(36);
    bag.add({ itemId: axe.material, count: 3 });
    const before = bag.snapshot();
    expect(craftRecipe(bag, axe.id)).toMatchObject({ success: false });
    expect(bag.snapshot()).toEqual(before);
    bag.add({ itemId: 'stick', count: 2 });
    expect(craftRecipe(bag, axe.id)).toMatchObject({ success: true });
    const made = bag.snapshot().find((slot) => slot?.itemId === axe.id);
    expect(made).toEqual({ itemId: axe.id, count: 1, instance: { durability: axe.durability } });
  }
});

it('各级剑由木棍与对应材料合成，melee 定义按等级递增伤害', () => {
  for (const sword of swordMatrix) {
    const definition = getItemDefinition(sword.id);
    expect(definition.itemType).toBe('tool');
    const melee = classicContent.items.capability(sword.id, 'melee');
    expect(melee).toMatchObject({ type: 'melee', definitionId: sword.id });
    const combo = getMeleeDefinition(sword.id);
    expect(combo.steps.length).toBe(2);
    expect(combo.steps[0].damage).toBe(sword.firstDamage);
    expect(combo.steps[1].damage).toBe(sword.firstDamage + 2);

    const bag = new Inventory(36);
    bag.add({ itemId: sword.material, count: 2 });
    const before = bag.snapshot();
    expect(craftRecipe(bag, sword.id)).toMatchObject({ success: false });
    expect(bag.snapshot()).toEqual(before);
    bag.add({ itemId: 'stick', count: 1 });
    expect(craftRecipe(bag, sword.id)).toMatchObject({ success: true });
    expect(bag.snapshot().some((slot) => slot?.itemId === sword.id)).toBe(true);
  }
});

it('斧头采集倍率仅在挖木类方块生效，耐久归零后移除', () => {
  const diamondAxe = createMiningToolUseCandidate(
    classicContent.items,
    { itemId: 'diamond-axe', count: 1, instance: { durability: 1 } },
    { preferredTool: 'axe', minimumTier: 1 },
  );
  expect(diamondAxe).toEqual({ multiplier: 8, nextStack: null });
  // 斧头对需要镐的方块不满足门槛
  expect(() =>
    createMiningToolUseCandidate(
      classicContent.items,
      { itemId: 'diamond-axe', count: 1, instance: { durability: 100 } },
      { preferredTool: 'pickaxe', minimumTier: 1 },
    ),
  ).toThrow();
});
