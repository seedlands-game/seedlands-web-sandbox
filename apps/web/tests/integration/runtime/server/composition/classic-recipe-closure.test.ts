import { expect, it } from 'vitest';
import { classicContent } from '../../../../fixtures/classic/content';
import { overworldStations } from '../../../../../../../playbooks/classic/src/stations';
import { overworldRecipes } from '../../../../../../../playbooks/classic/src/recipes';
import { stationRecipeFitsGrid } from '../../../../../../../packages/stdlib/src/server/gameplay/modules/station-candidates';

it('剩余半砖、食物、染料和羊毛配方形成完整 item 闭包', () => {
  for (const id of [
    'sandstone-slab',
    'wood-slab',
    'mushroom-stew',
    'yellow-dye',
    'red-dye',
    'white-dye',
    'orange-dye',
    'lime-dye',
    'light-blue-dye',
    'cyan-dye',
    'purple-dye',
    'magenta-dye',
    'pink-dye',
    'gray-dye',
    'light-gray-dye',
    ...[
      'white',
      'orange',
      'magenta',
      'light-blue',
      'yellow',
      'lime',
      'pink',
      'gray',
      'light-gray',
      'cyan',
      'purple',
      'blue',
      'brown',
      'green',
      'red',
      'black',
    ].map((color) => `${color}-wool`),
  ]) {
    expect(classicContent.items.has(id)).toBe(true);
    expect(classicContent.recipes.get(id)?.outputs.every((stack) => classicContent.items.has(stack.itemId))).toBe(true);
  }
});

it('仙人掌与钻石矿冶炼有明确输出并引用同一 registry', () => {
  expect(overworldStations.furnaceRecipes.find((recipe) => recipe.id === 'smelt-cactus')).toMatchObject({
    input: { itemId: 'cactus' },
    output: { itemId: 'green-dye' },
  });
  expect(overworldStations.furnaceRecipes.find((recipe) => recipe.id === 'smelt-diamond')).toMatchObject({
    input: { itemId: 'diamond-ore' },
    output: { itemId: 'diamond' },
  });
});

it('背包 2x2 与工作台 3x3 共用完整且唯一的 Classic 网格配方目录', () => {
  const recipes = overworldStations.recipes;
  expect(new Set(recipes.map((recipe) => recipe.id)).size).toBe(recipes.length);
  expect(new Set(recipes.map((recipe) => recipe.id))).toEqual(new Set(overworldRecipes.map((recipe) => recipe.id)));
  expect(recipes.every((recipe) => stationRecipeFitsGrid(recipe, 3))).toBe(true);

  expect(
    stationRecipeFitsGrid(
      recipes.find((recipe) => recipe.id === 'planks')!,
      2,
    ),
  ).toBe(true);
  expect(
    stationRecipeFitsGrid(
      recipes.find((recipe) => recipe.id === 'workbench')!,
      2,
    ),
  ).toBe(true);
  expect(
    stationRecipeFitsGrid(
      recipes.find((recipe) => recipe.id === 'wood-pickaxe')!,
      2,
    ),
  ).toBe(false);
  expect(
    stationRecipeFitsGrid(
      recipes.find((recipe) => recipe.id === 'chest')!,
      2,
    ),
  ).toBe(false);
  expect(
    stationRecipeFitsGrid(
      recipes.find((recipe) => recipe.id === 'furnace')!,
      2,
    ),
  ).toBe(false);
});
