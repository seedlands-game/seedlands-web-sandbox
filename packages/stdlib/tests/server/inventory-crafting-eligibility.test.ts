import { describe, expect, it } from 'vitest';
import { createGameplayContent } from '../../src/server/gameplay/gameplay-content';
import {
  buildInventoryActionCandidate,
  listCraftableInventoryRecipes,
  type InventoryActorProjectionV1,
} from '../../src/server/gameplay/modules/inventory-action-model';

const recipes = [
  { id: 'test:planks', inputs: [{ itemId: 'test:wood', count: 1 }], outputs: [{ itemId: 'test:plank', count: 2 }] },
  { id: 'test:beam', inputs: [{ itemId: 'test:wood', count: 3 }], outputs: [{ itemId: 'test:plank', count: 1 }] },
  { id: 'test:bulk', inputs: [{ itemId: 'test:wood', count: 1 }], outputs: [{ itemId: 'test:plank', count: 16 }] },
  {
    id: 'test:two-output',
    inputs: [{ itemId: 'test:wood', count: 1 }],
    outputs: [
      { itemId: 'test:plank', count: 8 },
      { itemId: 'test:stone', count: 1 },
    ],
  },
  {
    id: 'test:repair',
    inputs: [{ itemId: 'test:tool', count: 1, instance: { durability: 5 } }],
    outputs: [{ itemId: 'test:plank', count: 1 }],
  },
] as const;
const invalidCraftInputRecipeIds = [' test:spaced ', 'x'.repeat(257)] as const;

const content = (crafting?: Parameters<typeof createGameplayContent>[0]['crafting']) =>
  createGameplayContent({
    items: [
      { id: 'test:wood', name: 'Wood', itemType: 'resource', stackLimit: 8, capabilities: [] },
      { id: 'test:stone', name: 'Stone', itemType: 'resource', stackLimit: 8, capabilities: [] },
      { id: 'test:plank', name: 'Plank', itemType: 'resource', stackLimit: 8, capabilities: [] },
      {
        id: 'test:tool',
        name: 'Tool',
        itemType: 'tool',
        stackLimit: 1,
        durability: { max: 10 },
        capabilities: [],
      },
    ],
    recipes: [
      ...recipes,
      ...invalidCraftInputRecipeIds.map((id) => ({
        id,
        inputs: [{ itemId: 'test:wood', count: 1 }],
        outputs: [{ itemId: 'test:plank', count: 1 }],
      })),
    ],
    meleeDefinitions: [],
    ...(crafting === undefined ? {} : { crafting }),
  });

const actor = (slots: InventoryActorProjectionV1['slots'], selectedSlot = 0): InventoryActorProjectionV1 => ({
  version: 1,
  reference: { entityId: 'alice', epoch: 1, lifetime: 1 },
  kind: 'player',
  slots,
  equipment: { selectedSlot, hotbarSize: slots.length },
  lifecycle: 'alive',
  needs: { hunger: 20, maxHunger: 20, meaning: 'satiety' },
  inventoryRevision: 3,
  cursor: { version: 1, revision: 0, stack: null, origin: null },
});

const legacyCraftableRecipeIds = (gameplay: ReturnType<typeof content>, projection: InventoryActorProjectionV1) =>
  gameplay.recipes
    .list()
    .filter((recipe) => {
      try {
        buildInventoryActionCandidate(gameplay, { kind: 'craft', actor: projection, input: { recipeId: recipe.id } });
        return true;
      } catch {
        return false;
      }
    })
    .map((recipe) => recipe.id);

describe('inventory crafting eligibility', () => {
  it.each([
    ['craftable', actor([{ itemId: 'test:wood', count: 2 }, null, null])],
    ['missing inputs', actor([{ itemId: 'test:stone', count: 1 }, null, null])],
    [
      'full output capacity',
      actor([
        { itemId: 'test:wood', count: 2 },
        { itemId: 'test:stone', count: 8 },
        { itemId: 'test:stone', count: 8 },
      ]),
    ],
    ['multiple outputs after an input slot is cleared', actor([{ itemId: 'test:wood', count: 1 }, null, null])],
    ['durable instance', actor([{ itemId: 'test:tool', count: 1, instance: { durability: 5 } }, null, null])],
  ] as const)('matches full craft candidates for %s', (_state, projection) => {
    const gameplay = content();
    const before = structuredClone(projection);
    expect(listCraftableInventoryRecipes(gameplay, projection).map((recipe) => recipe.id)).toEqual(
      legacyCraftableRecipeIds(gameplay, projection),
    );
    expect(projection).toEqual(before);
  });

  it('uses the configured provider while preserving selected-slot and invalid-plan semantics', () => {
    const gameplay = content({
      version: 1,
      match({ selectedSlot }) {
        return selectedSlot === 1 ? [{ slot: 1, count: 1 }] : [{ slot: 99, count: 1 }];
      },
    });
    const selected = actor([null, { itemId: 'test:wood', count: 2 }, null], 1);
    const rejected = actor([{ itemId: 'test:wood', count: 2 }, null, null]);
    expect(listCraftableInventoryRecipes(gameplay, selected).map((recipe) => recipe.id)).toEqual(
      legacyCraftableRecipeIds(gameplay, selected),
    );
    expect(listCraftableInventoryRecipes(gameplay, rejected).map((recipe) => recipe.id)).toEqual(
      legacyCraftableRecipeIds(gameplay, rejected),
    );
  });

  it('gives each provider invocation a detached slot snapshot', () => {
    let previousSlots: InventoryActorProjectionV1['slots'] | undefined;
    const gameplay = content({
      version: 1,
      match({ slots }) {
        if (slots === previousSlots) return null;
        previousSlots = slots;
        return [{ slot: 0, count: 1 }];
      },
    });
    const projection = actor([{ itemId: 'test:wood', count: 2 }, null, null]);
    expect(listCraftableInventoryRecipes(gameplay, projection).map((recipe) => recipe.id)).toEqual(
      legacyCraftableRecipeIds(gameplay, projection),
    );
  });

  it('excludes registry recipe IDs which are invalid craft inputs', () => {
    const gameplay = content();
    const projection = actor([{ itemId: 'test:wood', count: 2 }, null, null]);
    const eligibleIds = listCraftableInventoryRecipes(gameplay, projection).map((recipe) => recipe.id);
    expect(eligibleIds).toEqual(legacyCraftableRecipeIds(gameplay, projection));
    expect(eligibleIds).not.toEqual(expect.arrayContaining([...invalidCraftInputRecipeIds]));
  });
});
