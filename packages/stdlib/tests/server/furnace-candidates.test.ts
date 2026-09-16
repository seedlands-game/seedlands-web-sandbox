import { describe, expect, it } from 'vitest';
import { createItemDefinitionRegistry } from '../../src/server/gameplay/item-registry';
import {
  advanceFurnaceCandidate,
  createFurnaceDefinitions,
  emptyFurnaceSnapshot,
  validateFurnaceSnapshot,
} from '../../src/server/gameplay/modules/furnace-candidates';

const item = (id: string, stackLimit = 64) => ({
  id,
  name: id,
  itemType: 'resource' as const,
  stackLimit,
  capabilities: [] as const,
});
const items = createItemDefinitionRegistry([
  item('test:ore'),
  item('test:ingot'),
  item('test:coal'),
  item('test:blocker'),
]);
const definitions = createFurnaceDefinitions({
  items,
  recipes: [
    {
      id: 'test:smelt',
      input: { itemId: 'test:ore', count: 1 },
      output: { itemId: 'test:ingot', count: 1 },
      durationSeconds: 5,
    },
  ],
  fuels: [{ itemId: 'test:coal', burnSeconds: 8 }],
});

describe('furnace detached candidates', () => {
  it('blocks without consuming input or fuel and emits each output at most once', () => {
    const blocked = {
      ...emptyFurnaceSnapshot(),
      input: { itemId: 'test:ore', count: 2 },
      fuel: { itemId: 'test:coal', count: 1 },
      output: { itemId: 'test:ingot', count: 64 },
    };
    const untouched = structuredClone(blocked);
    expect(advanceFurnaceCandidate(blocked, 20, definitions)).toEqual({
      snapshot: blocked,
      completedRecipeIds: [],
    });
    expect(blocked).toEqual(untouched);

    const unblocked = { ...blocked, output: null };
    const advanced = advanceFurnaceCandidate(unblocked, 20, definitions);
    expect(advanced).toEqual({
      snapshot: {
        version: 1,
        input: { itemId: 'test:ore', count: 1 },
        fuel: null,
        output: { itemId: 'test:ingot', count: 1 },
        activeRecipeId: 'test:smelt',
        remainingFuelSeconds: 0,
        progressSeconds: 3,
      },
      completedRecipeIds: ['test:smelt'],
    });
    expect(advanceFurnaceCandidate(advanced.snapshot, 0, definitions)).toEqual({
      snapshot: advanced.snapshot,
      completedRecipeIds: [],
    });
  });

  it('roundtrips a mid-smelt V1 checkpoint and advances deterministically by logical seconds', () => {
    const start = {
      ...emptyFurnaceSnapshot(),
      input: { itemId: 'test:ore', count: 1 },
      fuel: { itemId: 'test:coal', count: 1 },
    };
    const mid = advanceFurnaceCandidate(start, 2, definitions).snapshot;
    expect(mid).toEqual({
      version: 1,
      input: { itemId: 'test:ore', count: 1 },
      fuel: null,
      output: null,
      activeRecipeId: 'test:smelt',
      remainingFuelSeconds: 6,
      progressSeconds: 2,
    });
    const decoded = validateFurnaceSnapshot(JSON.parse(JSON.stringify(mid)), definitions);
    const restored = advanceFurnaceCandidate(decoded, 3, definitions);
    const direct = advanceFurnaceCandidate(start, 5, definitions);
    expect(restored).toEqual(direct);
    expect(restored).toEqual({
      snapshot: {
        version: 1,
        input: null,
        fuel: null,
        output: { itemId: 'test:ingot', count: 1 },
        activeRecipeId: null,
        remainingFuelSeconds: 3,
        progressSeconds: 0,
      },
      completedRecipeIds: ['test:smelt'],
    });
  });

  it('preserves partial progress and fuel while output remains blocked', () => {
    const partial = {
      version: 1 as const,
      input: { itemId: 'test:ore', count: 1 },
      fuel: null,
      output: { itemId: 'test:ingot', count: 64 },
      activeRecipeId: 'test:smelt',
      remainingFuelSeconds: 6,
      progressSeconds: 2,
    };
    expect(advanceFurnaceCandidate(partial, 100, definitions)).toEqual({
      snapshot: partial,
      completedRecipeIds: [],
    });
  });

  it('rejects unknown items, malformed snapshots, invalid times and implicit cross-world definitions', () => {
    expect(() => validateFurnaceSnapshot({ ...emptyFurnaceSnapshot(), version: 2 }, definitions)).toThrow(/version/i);
    expect(() =>
      validateFurnaceSnapshot({ ...emptyFurnaceSnapshot(), input: { itemId: 'test:missing', count: 1 } }, definitions),
    ).toThrow(/unknown item/i);
    expect(() =>
      validateFurnaceSnapshot(
        {
          ...emptyFurnaceSnapshot(),
          input: { itemId: 'test:ore', count: 1 },
          activeRecipeId: 'test:smelt',
          progressSeconds: 5,
        },
        definitions,
      ),
    ).toThrow(/progress/i);
    expect(() => advanceFurnaceCandidate(emptyFurnaceSnapshot(), Number.POSITIVE_INFINITY, definitions)).toThrow(
      /logical seconds/i,
    );

    const otherItems = createItemDefinitionRegistry([item('other:ore'), item('other:coal')]);
    expect(() =>
      createFurnaceDefinitions({
        items: otherItems,
        recipes: [
          {
            id: 'other:smelt',
            input: { itemId: 'test:ore', count: 1 },
            output: { itemId: 'other:ore', count: 1 },
            durationSeconds: 1,
          },
        ],
        fuels: [{ itemId: 'other:coal', burnSeconds: 1 }],
      }),
    ).toThrow(/unknown item/i);
  });

  it('rejects time values that overflow the supported logical precision and validates rounded progress', () => {
    expect(() =>
      validateFurnaceSnapshot({ ...emptyFurnaceSnapshot(), remainingFuelSeconds: Number.MAX_VALUE }, definitions),
    ).toThrow(/time/i);
    expect(() => advanceFurnaceCandidate(emptyFurnaceSnapshot(), Number.MAX_VALUE, definitions)).toThrow(/seconds/i);
    expect(() =>
      validateFurnaceSnapshot(
        {
          ...emptyFurnaceSnapshot(),
          input: { itemId: 'test:ore', count: 1 },
          activeRecipeId: 'test:smelt',
          progressSeconds: 4.9999999,
        },
        definitions,
      ),
    ).toThrow(/progress/i);
  });

  it('rejects duplicate recipe inputs, duplicate fuels and invalid definition durations', () => {
    const recipe = definitions.listRecipes()[0]!;
    const fuel = definitions.listFuels()[0]!;
    expect(() =>
      createFurnaceDefinitions({ items, recipes: [recipe, { ...recipe, id: 'test:again' }], fuels: [fuel] }),
    ).toThrow(/duplicate.*input/i);
    expect(() => createFurnaceDefinitions({ items, recipes: [recipe], fuels: [fuel, fuel] })).toThrow(
      /duplicate.*fuel/i,
    );
    expect(() =>
      createFurnaceDefinitions({ items, recipes: [{ ...recipe, durationSeconds: 0 }], fuels: [fuel] }),
    ).toThrow(/duration/i);
  });
});
