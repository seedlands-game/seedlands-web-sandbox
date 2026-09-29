import { describe, expect, it } from 'vitest';
import { orderPersonalRecipes } from '../../../src/app/ui/personal-recipe-order';

const recipe = (id: string, craftable = false) => ({
  id,
  name: id,
  requirements: '',
  result: '',
  craftable,
});

describe('个人配方展示顺序', () => {
  it('先展示可合成的基础材料与工具路径，而不是注册顺序或汉字名称', () => {
    const ordered = orderPersonalRecipes([
      recipe('iron-block-unpack', true),
      recipe('wood-axe', true),
      recipe('planks', true),
      recipe('sticks', true),
      recipe('wood-sword'),
    ]);

    expect(ordered.map((entry) => entry.id)).toEqual([
      'planks',
      'sticks',
      'wood-axe',
      'iron-block-unpack',
      'wood-sword',
    ]);
  });

  it('为未知模组配方保留稳定的 ID 回退顺序', () => {
    expect(orderPersonalRecipes([recipe('pack:zeta'), recipe('pack:alpha')]).map((entry) => entry.id)).toEqual([
      'pack:alpha',
      'pack:zeta',
    ]);
  });
});
