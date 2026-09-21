import { expect, it } from 'vitest';
import { classicContent } from '../../../../fixtures/classic/content';
import { overworldStations } from '../../../../../../../playbooks/classic/src/stations';

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
