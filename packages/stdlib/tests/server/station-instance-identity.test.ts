import { expect, it } from 'vitest';
import { createItemDefinitionRegistry, type ItemStack } from '../../src/server/gameplay/item-registry';
import { createStationCraftCandidate, type StationRecipe } from '../../src/server/gameplay/modules/station-candidates';
import {
  advanceFurnaceCandidate,
  createFurnaceDefinitions,
  emptyFurnaceSnapshot,
  validateFurnaceSnapshot,
} from '../../src/server/gameplay/modules/furnace-candidates';

const items = createItemDefinitionRegistry([
  { id: 'test:tool', name: 'Tool', itemType: 'tool', stackLimit: 1, durability: { max: 8 }, capabilities: [] },
  { id: 'test:coal', name: 'Coal', itemType: 'resource', stackLimit: 64, capabilities: [] },
]);
const tool = (durability: number): ItemStack => ({ itemId: 'test:tool', count: 1, instance: { durability } });

it.each(['shaped', 'shapeless'] as const)('matches %s ingredients by complete instance identity', (kind) => {
  const grid = [tool(2), tool(8), ...Array<null>(7).fill(null)];
  const recipe: StationRecipe =
    kind === 'shaped'
      ? { kind, id: 'test:repair', pattern: [tool(8), ...Array<null>(8).fill(null)], outputs: [tool(8)] }
      : { kind, id: 'test:repair', inputs: [tool(8)], outputs: [tool(8)] };
  const wrongGrid = [tool(2), ...Array<null>(8).fill(null)];
  expect(createStationCraftCandidate({ grid: wrongGrid, output: [null], recipe, items })).toEqual({
    success: false,
    reason: 'recipe-mismatch',
  });
  if (kind === 'shapeless') {
    const result = createStationCraftCandidate({ grid, output: [null], recipe, items });
    expect(result).toEqual({ success: true, grid: [tool(2), ...Array<null>(8).fill(null)], output: [tool(8)] });
    expect(grid[1]).toEqual(tool(8));
  }
});

it('freezes furnace instance definitions and refuses a different input instance', () => {
  const input = { itemId: 'test:tool', count: 1, instance: { durability: 2 } };
  const output = { itemId: 'test:tool', count: 1, instance: { durability: 8 } };
  const definitions = createFurnaceDefinitions({
    items,
    recipes: [{ id: 'test:repair', input, output, durationSeconds: 1 }],
    fuels: [{ itemId: 'test:coal', burnSeconds: 2 }],
  });
  input.instance.durability = 3;
  output.instance.durability = 4;
  expect(definitions.recipe('test:repair')?.input).toEqual(tool(2));
  expect(definitions.recipe('test:repair')?.output).toEqual(tool(8));
  expect(Object.isFrozen(definitions.recipe('test:repair')?.output.instance)).toBe(true);
  const start = { ...emptyFurnaceSnapshot(), input: tool(3), fuel: { itemId: 'test:coal', count: 1 } };
  expect(advanceFurnaceCandidate(start, 1, definitions)).toEqual({ snapshot: start, completedRecipeIds: [] });
  expect(() =>
    validateFurnaceSnapshot({ ...start, activeRecipeId: 'test:repair', progressSeconds: 0.5 }, definitions),
  ).toThrow(/input/);
  expect(advanceFurnaceCandidate({ ...start, input: tool(2) }, 1, definitions).snapshot.output).toEqual(tool(8));
});
