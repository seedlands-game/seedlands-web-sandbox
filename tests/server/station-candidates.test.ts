import { describe, expect, it } from 'vitest';
import { createItemDefinitionRegistry } from '../../packages/game-core/src/server/gameplay/item-registry';
import {
  createStationCraftCandidate,
  matchesShapedStationRecipe,
  matchesShapelessStationRecipe,
  type ShapedStationRecipe,
  type ShapelessStationRecipe,
} from '../../packages/game-core/src/server/gameplay/modules/station-candidates';

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
const empty = (): Array<{ itemId: string; count: number } | null> => Array.from({ length: 9 }, () => null);

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
  it('requires exact 3x3 shaped positions including null slots', () => {
    const correct = empty();
    correct[0] = { itemId: 'test:wood', count: 2 };
    correct[1] = { itemId: 'test:wood', count: 1 };
    correct[3] = { itemId: 'test:stone', count: 1 };
    expect(matchesShapedStationRecipe(correct, shaped, items)).toBe(true);

    const shifted = empty();
    shifted[1] = { itemId: 'test:wood', count: 2 };
    shifted[2] = { itemId: 'test:wood', count: 1 };
    shifted[4] = { itemId: 'test:stone', count: 1 };
    expect(matchesShapedStationRecipe(shifted, shaped, items)).toBe(false);

    const occupiedNull = correct.map((slot) => (slot ? { ...slot } : null));
    occupiedNull[8] = { itemId: 'test:extra', count: 1 };
    expect(matchesShapedStationRecipe(occupiedNull, shaped, items)).toBe(false);
  });

  it('matches shapeless inputs independent of slots and leaves unrelated grid contents', () => {
    const grid = empty();
    grid[8] = { itemId: 'test:wood', count: 3 };
    grid[4] = { itemId: 'test:stone', count: 1 };
    grid[0] = { itemId: 'test:extra', count: 2 };
    expect(matchesShapelessStationRecipe(grid, shapeless, items)).toBe(true);

    const result = createStationCraftCandidate({ grid, output: [null], recipe: shapeless, items });
    expect(result).toEqual({
      success: true,
      grid: [
        { itemId: 'test:extra', count: 2 },
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        { itemId: 'test:wood', count: 1 },
      ],
      output: [{ itemId: 'test:bench', count: 1 }],
    });
    expect(grid[8]).toEqual({ itemId: 'test:wood', count: 3 });
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
    expect(() => matchesShapedStationRecipe(empty().slice(0, 8), shaped, items)).toThrow(/3x3|grid/i);
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
