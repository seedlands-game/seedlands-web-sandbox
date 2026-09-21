import { expect, it } from 'vitest';
import { classicContent, getItemDefinition } from '../../../../fixtures/classic/content';
import {
  createFurnaceDefinitions,
  emptyFurnaceSnapshot,
  advanceFurnaceCandidate,
} from '../../../../../../../packages/stdlib/src/server/gameplay/modules/furnace-candidates';
import { foodEffect } from '../../../../../../../packages/stdlib/src/server/gameplay/modules/food-effect';
import { overworldStations } from '../../../../../../../playbooks/classic/src/stations';

const foods = [
  { id: 'apple', health: 4 },
  { id: 'bread', health: 5 },
  { id: 'cooked-porkchop', health: 8 },
  { id: 'cooked-fish', health: 5 },
] as const;

it('新增熟食为可消费 food，healthRestore 分级并按满血/满饥饿规则结算', () => {
  for (const food of foods) {
    const definition = getItemDefinition(food.id);
    expect(definition.itemType).toBe('food');
    const consume = classicContent.items.capability(food.id, 'consume');
    expect(consume).toMatchObject({ type: 'consume', healthRestore: food.health });

    // 受伤时进食恢复生命，夹在 maxHealth 内
    const effect = foodEffect(consume!, { hunger: 0, maxHunger: 20, meaning: 'satiety' }, { health: 6, maxHealth: 20 });
    expect(effect.health).toBe(Math.min(20, 6 + food.health));
    // 满血且满饥饿则拒绝
    expect(() =>
      foodEffect(consume!, { hunger: 20, maxHunger: 20, meaning: 'satiety' }, { health: 20, maxHealth: 20 }),
    ).toThrow('health-full');
  }
});

it('生猪肉与生鱼经熔炉冶炼得到熟食，半程恢复不复制产出', () => {
  const definitions = createFurnaceDefinitions({
    items: classicContent.items,
    recipes: overworldStations.furnaceRecipes,
    fuels: overworldStations.fuels,
  });
  for (const [input, output] of [
    ['raw-porkchop', 'cooked-porkchop'],
    ['raw-fish', 'cooked-fish'],
  ] as const) {
    const started = {
      ...emptyFurnaceSnapshot(),
      input: { itemId: input, count: 2 },
      fuel: { itemId: 'coal', count: 1 },
    };
    const first = advanceFurnaceCandidate(started, 5, definitions).snapshot;
    expect(first.output).toBeNull();
    const restored = JSON.parse(JSON.stringify(first));
    const done = advanceFurnaceCandidate(restored, 15, definitions).snapshot;
    expect(done.input).toBeNull();
    expect(done.output).toEqual({ itemId: output, count: 2 });
  }
});
