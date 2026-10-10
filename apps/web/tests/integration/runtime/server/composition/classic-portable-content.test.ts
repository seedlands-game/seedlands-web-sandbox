import { expect, it } from 'vitest';
import { createPlayerState, classicContent, craftRecipe } from '../../../../fixtures/classic/content';

const items = [
  'flint-and-steel',
  'mushroom-stew',
  'painting',
  'golden-apple',
  'sign',
  'wooden-door',
  'snowball',
  'brick',
  'clay',
  'book',
  'sugar',
  'cake',
  'cookie',
  'record-13',
  'record-cat',
  'cocoa-beans',
] as const;

it('补齐便携物品注册与原创资产所需稳定 identity', () => {
  for (const id of items) expect(classicContent.items.require(id).id).toBe(id);
  expect(classicContent.items.require('flint-and-steel')).toMatchObject({ durability: { max: 65 }, stackLimit: 1 });
  expect(classicContent.items.capability('golden-apple', 'consume')).toMatchObject({ healthRestore: 10 });
});

it('补齐纸书食物与装饰材料配方并保持材料守恒', () => {
  for (const id of [
    'paper',
    'book',
    'wool',
    'painting',
    'golden-apple',
    'sign',
    'wooden-door',
    'sugar',
    'cake',
    'cookie',
    'clay-block',
    'snow-block',
    'lapis-block',
    'lapis-block-unpack',
    'flint-and-steel',
  ])
    expect(classicContent.recipes.get(id)?.id).toBe(id);
  for (const id of ['gravel', 'lapis-ore', 'clay-block', 'ice', 'snow-block', 'lapis-block'])
    expect(classicContent.items.require(id).placesVoxel).toBeTypeOf('number');
  const player = createPlayerState('crafter', [0, 0, 0]);
  player.inventory.add({ itemId: 'wheat', count: 2 });
  player.inventory.add({ itemId: 'cocoa-beans', count: 1 });
  expect(craftRecipe(player.inventory, 'cookie')).toMatchObject({ success: true });
  expect(player.inventory.containsAmount('cookie', 8)).toBe(true);
  expect(craftRecipe(player.inventory, 'cookie')).toEqual({ success: false, reason: 'missing-inputs' });
});
