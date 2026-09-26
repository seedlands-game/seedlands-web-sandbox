import { describe, expect, it } from 'vitest';
import { createItemDefinitionRegistry } from '../../src/server/gameplay/item-registry';
import {
  createStationCraftCandidate,
  matchesShapedStationRecipe,
  matchesShapelessStationRecipe,
  stationRecipeFitsGrid,
  type ShapedStationRecipe,
  type ShapelessStationRecipe,
} from '../../src/server/gameplay/modules/station-candidates';

const item = (id: string, stackLimit = 64) => ({
  id,
  name: id,
  itemType: 'resource' as const,
  stackLimit,
  capabilities: [] as const,
});

const items = createItemDefinitionRegistry([
  item('test:wood'),
  item('test:stone'),
  item('test:bench', 1),
  item('test:extra'),
]);
const empty = (size = 3): Array<{ itemId: string; count: number } | null> =>
  Array.from({ length: size * size }, () => null);

const shaped: ShapedStationRecipe = {
  kind: 'shaped',
  id: 'test:bench',
  pattern: [
    { itemId: 'test:wood', count: 1 },
    { itemId: 'test:wood', count: 1 },
    null,
    { itemId: 'test:stone', count: 1 },
    null,
    null,
    null,
    null,
    null,
  ],
  outputs: [{ itemId: 'test:bench', count: 1 }],
};

const shapeless: ShapelessStationRecipe = {
  kind: 'shapeless',
  id: 'test:mixed-bench',
  inputs: [
    { itemId: 'test:wood', count: 2 },
    { itemId: 'test:stone', count: 1 },
  ],
  outputs: [{ itemId: 'test:bench', count: 1 }],
};

describe('station detached candidates', () => {
  it('matches a shaped footprint at any valid offset without accepting extra occupied slots', () => {
    const correct = empty();
    correct[0] = { itemId: 'test:wood', count: 2 };
    correct[1] = { itemId: 'test:wood', count: 1 };
    correct[3] = { itemId: 'test:stone', count: 1 };
    expect(matchesShapedStationRecipe(correct, shaped, items)).toBe(true);

    const shifted = empty();
    shifted[1] = { itemId: 'test:wood', count: 2 };
    shifted[2] = { itemId: 'test:wood', count: 1 };
    shifted[4] = { itemId: 'test:stone', count: 1 };
    expect(matchesShapedStationRecipe(shifted, shaped, items)).toBe(true);

    const occupiedNull = correct.map((slot) => (slot ? { ...slot } : null));
    occupiedNull[8] = { itemId: 'test:extra', count: 1 };
    expect(matchesShapedStationRecipe(occupiedNull, shaped, items)).toBe(false);
  });

  it('matches shapeless inputs independent of slots and rejects unrelated grid contents', () => {
    const grid = empty();
    grid[8] = { itemId: 'test:wood', count: 3 };
    grid[4] = { itemId: 'test:stone', count: 1 };
    expect(matchesShapelessStationRecipe(grid, shapeless, items)).toBe(true);

    const result = createStationCraftCandidate({ grid, output: [null], recipe: shapeless, items });
    expect(result).toEqual({
      success: true,
      grid: [null, null, null, null, null, null, null, null, { itemId: 'test:wood', count: 1 }],
      output: [{ itemId: 'test:bench', count: 1 }],
    });
    expect(grid[8]).toEqual({ itemId: 'test:wood', count: 3 });

    const occupied = grid.map((slot) => (slot ? { ...slot } : null));
    occupied[0] = { itemId: 'test:extra', count: 1 };
    expect(matchesShapelessStationRecipe(occupied, shapeless, items)).toBe(false);
  });

  it('uses one shared recipe contract for 2x2 and 3x3 grids', () => {
    expect(stationRecipeFitsGrid(shaped, 2)).toBe(true);
    expect(stationRecipeFitsGrid(shapeless, 2)).toBe(true);

    const personal = empty(2);
    personal[0] = { itemId: 'test:wood', count: 2 };
    personal[1] = { itemId: 'test:wood', count: 1 };
    personal[2] = { itemId: 'test:stone', count: 1 };
    expect(matchesShapedStationRecipe(personal, shaped, items)).toBe(true);
    const crafted = createStationCraftCandidate({ grid: personal, output: [null], recipe: shaped, items });
    expect(crafted).toEqual({
      success: true,
      grid: [{ itemId: 'test:wood', count: 1 }, null, null, null],
      output: [{ itemId: 'test:bench', count: 1 }],
    });

    const tooWide: ShapedStationRecipe = {
      ...shaped,
      id: 'test:wide',
      pattern: [
        { itemId: 'test:wood', count: 1 },
        { itemId: 'test:wood', count: 1 },
        { itemId: 'test:wood', count: 1 },
        null,
        null,
        null,
        null,
        null,
        null,
      ],
    };
    expect(stationRecipeFitsGrid(tooWide, 2)).toBe(false);
    expect(stationRecipeFitsGrid(tooWide, 3)).toBe(true);
    expect(matchesShapedStationRecipe(personal, tooWide, items)).toBe(false);
  });

  it('matches duplicate shapeless identities independent of input and slot count ordering', () => {
    const recipe: ShapelessStationRecipe = {
      ...shapeless,
      id: 'test:ordered-counts',
      inputs: [
        { itemId: 'test:wood', count: 1 },
        { itemId: 'test:wood', count: 2 },
      ],
    };
    const grid = [{ itemId: 'test:wood', count: 2 }, { itemId: 'test:wood', count: 1 }, null, null];
    expect(matchesShapelessStationRecipe(grid, recipe, items)).toBe(true);
    expect(createStationCraftCandidate({ grid, output: [null], recipe, items })).toMatchObject({
      success: true,
      grid: [null, null, null, null],
    });
  });

  it('returns detached success candidates and preserves every input on mismatch or full output', () => {
    const grid = empty();
    grid[0] = { itemId: 'test:wood', count: 2 };
    grid[1] = { itemId: 'test:wood', count: 1 };
    grid[3] = { itemId: 'test:stone', count: 1 };
    const beforeGrid = structuredClone(grid);
    const output = [{ itemId: 'test:stone', count: 64 }];
    const beforeOutput = structuredClone(output);

    expect(createStationCraftCandidate({ grid, output, recipe: shaped, items })).toEqual({
      success: false,
      reason: 'output-full',
    });
    expect(grid).toEqual(beforeGrid);
    expect(output).toEqual(beforeOutput);

    const wrong = empty();
    expect(createStationCraftCandidate({ grid: wrong, output: [null], recipe: shaped, items })).toEqual({
      success: false,
      reason: 'recipe-mismatch',
    });
    expect(wrong).toEqual(empty());

    const success = createStationCraftCandidate({ grid, output: [null], recipe: shaped, items });
    expect(success.success).toBe(true);
    if (!success.success) throw new Error('Expected a successful station candidate.');
    expect(success.grid).toEqual([{ itemId: 'test:wood', count: 1 }, ...Array.from({ length: 8 }, () => null)]);
    expect(success.output).toEqual([{ itemId: 'test:bench', count: 1 }]);
    expect(grid).toEqual(beforeGrid);
  });

  it('rejects bad schemas and unknown or cross-world item references', () => {
    const other = createItemDefinitionRegistry([item('other:wood')]);
    expect(() => matchesShapedStationRecipe(empty().slice(0, 8), shaped, items)).toThrow(/2x2|3x3|grid/i);
    expect(() =>
      matchesShapedStationRecipe(empty(), { ...shaped, pattern: shaped.pattern.slice(0, 8) }, items),
    ).toThrow(/3x3|pattern/i);
    expect(() =>
      createStationCraftCandidate({
        grid: empty(),
        output: [null],
        recipe: { ...shaped, outputs: [{ itemId: 'test:missing', count: 1 }] },
        items,
      }),
    ).toThrow(/unknown item/i);
    expect(() =>
      matchesShapedStationRecipe(
        empty(),
        { ...shaped, pattern: [...shaped.pattern.slice(0, 8), { itemId: 'test:missing', count: 1 }] },
        items,
      ),
    ).toThrow(/unknown item/i);
    expect(() =>
      createStationCraftCandidate({
        grid: empty(),
        output: [{ itemId: 'test:missing', count: 1 }],
        recipe: shaped,
        items,
      }),
    ).toThrow(/unknown item/i);
    expect(() => matchesShapelessStationRecipe(empty(), shapeless, other)).toThrow(/unknown item/i);
  });
});
