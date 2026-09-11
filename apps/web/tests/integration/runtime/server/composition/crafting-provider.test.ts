import { describe, expect, it } from 'vitest';
import { Inventory } from '../../../../../../../packages/stdlib/src/server/gameplay/inventory';
import { createItemDefinitionRegistry } from '../../../../../../../packages/stdlib/src/server/gameplay/item-registry';
import { createRecipeRegistry } from '../../../../../../../packages/stdlib/src/server/gameplay/recipe-registry';
import {
  applyCraftingMatch,
  shapelessCraftingProvider,
  type CraftingProviderV1,
} from '../../../../../../../packages/stdlib/src/server/gameplay/modules/crafting-provider';

const items = createItemDefinitionRegistry([
  { id: 'input', name: 'Input', itemType: 'resource', stackLimit: 8, capabilities: [] },
  { id: 'output', name: 'Output', itemType: 'resource', stackLimit: 8, capabilities: [] },
]);
const recipes = createRecipeRegistry(
  [{ id: 'convert', inputs: [{ itemId: 'input', count: 2 }], outputs: [{ itemId: 'output', count: 3 }] }],
  items,
);
const clicked: CraftingProviderV1 = {
  version: 1,
  match({ slots, selectedSlot }) {
    return slots[selectedSlot]?.itemId === 'input' && slots[selectedSlot]!.count >= 2
      ? [{ slot: selectedSlot, count: 2 }]
      : null;
  },
};
describe('replaceable crafting matching with shared atomic inventory transaction', () => {
  it('uses selected-slot semantics without shapeless fallback and grants no mutable inventory handle', () => {
    const inventory = new Inventory(3, [null, { itemId: 'input', count: 2 }, null], items);
    const before = inventory.snapshot();
    expect(applyCraftingMatch(inventory, 'convert', recipes, clicked, 0).success).toBe(false);
    expect(inventory.snapshot()).toEqual(before);
    expect(applyCraftingMatch(inventory, 'convert', recipes, clicked, 1).success).toBe(true);
    expect(inventory.snapshot()).toEqual([{ itemId: 'output', count: 3 }, null, null]);
  });
  it.each(
    [
      [{ slot: 0, count: 1 }],
      [{ slot: 0, count: 3 }],
      [
        { slot: 0, count: 1 },
        { slot: 0, count: 1 },
      ],
      [{ slot: 8, count: 2 }],
    ].map((plan) => ({ plan })),
  )('rejects invalid consumption plan $plan without losing inputs', ({ plan }) => {
    const inventory = new Inventory(1, [{ itemId: 'input', count: 2 }], items);
    const before = inventory.snapshot();
    expect(() => applyCraftingMatch(inventory, 'convert', recipes, { version: 1, match: () => plan }, 0)).toThrow();
    expect(inventory.snapshot()).toEqual(before);
  });
  it('passes immutable detached slots to matcher code', () => {
    const inventory = new Inventory(1, [{ itemId: 'input', count: 2 }], items);
    const before = inventory.snapshot();
    expect(() =>
      applyCraftingMatch(
        inventory,
        'convert',
        recipes,
        {
          version: 1,
          match(request) {
            Object.assign(request.slots[0]!, { count: 0 });
            return null;
          },
        },
        0,
      ),
    ).toThrow();
    expect(inventory.snapshot()).toEqual(before);
  });
  it('checks output capacity after valid consumption and rejects absent providers', () => {
    const inventory = new Inventory(1, [{ itemId: 'input', count: 3 }], items);
    const before = inventory.snapshot();
    expect(applyCraftingMatch(inventory, 'convert', recipes, shapelessCraftingProvider, 0)).toMatchObject({
      success: false,
    });
    expect(inventory.snapshot()).toEqual(before);
    expect(applyCraftingMatch(inventory, 'convert', recipes, null, 0)).toMatchObject({
      success: false,
      reason: 'crafting-unavailable',
    });
  });
});
