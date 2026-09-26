import { expect, it } from 'vitest';
import { classicContent, getVoxelGameplayDefinition } from '../../../../fixtures/classic/content';
import {
  createFurnaceDefinitions,
  emptyFurnaceSnapshot,
  advanceFurnaceCandidate,
} from '../../../../../../../packages/stdlib/src/server/gameplay/modules/furnace-candidates';
import { overworldStations } from '../../../../../../../playbooks/classic/src/stations';

it('圆石/玻璃/木炭取得链使用正式内容，半程恢复不复制产出', () => {
  expect(getVoxelGameplayDefinition(3).drop).toEqual({ itemId: 'cobblestone', count: 1 });
  expect(classicContent.items.capability('raw-iron', 'place')).toMatchObject({ voxel: 15 });
  const definitions = createFurnaceDefinitions({
    items: classicContent.items,
    recipes: overworldStations.furnaceRecipes,
    fuels: overworldStations.fuels,
  });
  for (const [input, output] of [
    ['cobblestone', 'stone-block'],
    ['sand-block', 'glass'],
    ['wood-block', 'charcoal'],
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
    expect(done.remainingFuelSeconds).toBe(60);
  }
  expect(definitions.fuel('charcoal')?.burnSeconds).toBe(80);
  const fueled = advanceFurnaceCandidate(
    { ...emptyFurnaceSnapshot(), input: { itemId: 'sand-block', count: 1 }, fuel: { itemId: 'charcoal', count: 1 } },
    10,
    definitions,
  ).snapshot;
  expect(fueled.output).toEqual({ itemId: 'glass', count: 1 });
  expect(fueled.fuel).toBeNull();
  expect(fueled.remainingFuelSeconds).toBe(70);
});
