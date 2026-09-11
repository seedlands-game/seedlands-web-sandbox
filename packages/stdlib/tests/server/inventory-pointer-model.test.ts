import { describe, expect, it } from 'vitest';
import { createGameplayContent } from '../../src/server/gameplay/gameplay-content';
import {
  buildInventoryPointerCandidate,
  type InventoryPointerInputV1,
} from '../../src/server/gameplay/modules/inventory-pointer-model';

const content = createGameplayContent({
  items: [
    { id: 'test:wood', name: 'Wood', itemType: 'resource', stackLimit: 64, capabilities: [] },
    { id: 'test:stone', name: 'Stone', itemType: 'resource', stackLimit: 64, capabilities: [] },
    { id: 'test:tool', name: 'Tool', itemType: 'tool', stackLimit: 1, durability: { max: 10 }, capabilities: [] },
  ],
  recipes: [],
  meleeDefinitions: [],
});

const stationContent = createGameplayContent({
  items: [
    { id: 'test:ore', name: 'Ore', itemType: 'resource', stackLimit: 64, capabilities: [] },
    { id: 'test:coal', name: 'Coal', itemType: 'resource', stackLimit: 64, capabilities: [] },
    { id: 'test:ingot', name: 'Ingot', itemType: 'resource', stackLimit: 64, capabilities: [] },
  ],
  recipes: [],
  meleeDefinitions: [],
  stations: {
    definitions: [{ kind: 'furnace', voxel: 13 }],
    recipes: [],
    furnaceRecipes: [
      {
        id: 'test:smelt',
        input: { itemId: 'test:ore', count: 1 },
        output: { itemId: 'test:ingot', count: 1 },
        durationSeconds: 1,
      },
    ],
    fuels: [{ itemId: 'test:coal', burnSeconds: 2 }],
  },
});

const actor = (count = 9) => ({
  version: 1 as const,
  reference: { entityId: 'alice', epoch: 1, lifetime: 1 },
  kind: 'player' as const,
  slots: [{ itemId: 'test:wood', count }, ...Array(23).fill(null)],
  equipment: { selectedSlot: 0, hotbarSize: 8 },
  lifecycle: 'alive' as const,
  needs: { hunger: 20, maxHunger: 20, meaning: 'satiety' as const },
  inventoryRevision: 4,
  cursor: { version: 1 as const, revision: 0, stack: null, origin: null },
});

const input = (command: InventoryPointerInputV1['command']): InventoryPointerInputV1 => ({
  actor: { entityId: 'alice', epoch: 1, lifetime: 1 },
  expectedInventoryRevision: 4,
  command,
});

describe('inventory pointer candidate', () => {
  it('right-clicks nine items into source four and authoritative cursor five', () => {
    const result = buildInventoryPointerCandidate(content, {
      actor: actor(),
      input: input({ kind: 'click', slot: { kind: 'inventory', slot: 0 }, button: 2 }),
    });
    expect(result.slots[0]).toEqual({ itemId: 'test:wood', count: 4 });
    expect(result.cursor).toMatchObject({ revision: 1, stack: { itemId: 'test:wood', count: 5 } });
    expect(result.inventoryRevision).toBe(5);
  });

  it('left and right distributes once across deduplicated targets', () => {
    const picked = buildInventoryPointerCandidate(content, {
      actor: actor(10),
      input: input({ kind: 'click', slot: { kind: 'inventory', slot: 0 }, button: 0 }),
    });
    const spreadActor = { ...actor(10), slots: picked.slots, inventoryRevision: 5, cursor: picked.cursor };
    const left = buildInventoryPointerCandidate(content, {
      actor: spreadActor,
      input: {
        ...input({
          kind: 'distribute',
          button: 0,
          targets: [1, 2, 2, 3].map((slot) => ({ kind: 'inventory' as const, slot })),
        }),
        expectedInventoryRevision: 5,
      },
    });
    expect(left.slots.slice(1, 4).map((slot) => slot?.count)).toEqual([3, 3, 3]);
    expect(left.cursor.stack?.count).toBe(1);

    const rightActor = { ...spreadActor, cursor: { ...picked.cursor, stack: { itemId: 'test:wood', count: 3 } } };
    const right = buildInventoryPointerCandidate(content, {
      actor: rightActor,
      input: {
        ...input({
          kind: 'distribute',
          button: 2,
          targets: [1, 2, 1, 3].map((slot) => ({ kind: 'inventory' as const, slot })),
        }),
        expectedInventoryRevision: 5,
      },
    });
    expect(right.slots.slice(1, 4).map((slot) => slot?.count)).toEqual([1, 1, 1]);
    expect(right.cursor.stack).toBeNull();
  });

  it('rejects a stale actor inventory revision without producing a candidate', () => {
    expect(() =>
      buildInventoryPointerCandidate(content, {
        actor: actor(),
        input: { ...input({ kind: 'close' }), expectedInventoryRevision: 3 },
      }),
    ).toThrow(/stale-inventory-revision/);
  });

  it('swaps different identities without merging and drops only the requested cursor amount', () => {
    const holding = {
      ...actor(1),
      slots: [{ itemId: 'test:stone', count: 3 }, ...Array(23).fill(null)],
      cursor: {
        version: 1 as const,
        revision: 2,
        stack: { itemId: 'test:wood', count: 5 },
        origin: { kind: 'inventory' as const, slot: 1 },
      },
    };
    const swapped = buildInventoryPointerCandidate(content, {
      actor: holding,
      input: input({ kind: 'click', slot: { kind: 'inventory', slot: 0 }, button: 2 }),
    });
    expect(swapped.slots[0]).toEqual({ itemId: 'test:wood', count: 5 });
    expect(swapped.cursor.stack).toEqual({ itemId: 'test:stone', count: 3 });
    const dropped = buildInventoryPointerCandidate(content, {
      actor: { ...holding, slots: swapped.slots, inventoryRevision: 5, cursor: swapped.cursor },
      input: {
        ...input({ kind: 'drop', button: 2 }),
        expectedInventoryRevision: 5,
      },
    });
    expect(dropped.dropIntents).toEqual([{ itemId: 'test:stone', count: 1 }]);
    expect(dropped.cursor.stack).toEqual({ itemId: 'test:stone', count: 2 });
  });

  it('settles a full bag by clearing the cursor into one formal drop intent', () => {
    const full = {
      ...actor(),
      slots: Array.from({ length: 24 }, () => ({ itemId: 'test:wood', count: 64 })),
      cursor: {
        version: 1 as const,
        revision: 7,
        stack: { itemId: 'test:stone', count: 3 },
        origin: null,
      },
    };
    const closed = buildInventoryPointerCandidate(content, { actor: full, input: input({ kind: 'close' }) });
    expect(closed.slots).toEqual(full.slots);
    expect(closed.cursor).toMatchObject({ revision: 8, stack: null, origin: null });
    expect(closed.dropIntents).toEqual([{ itemId: 'test:stone', count: 3 }]);
  });

  it('rejects illegal furnace output placement atomically', () => {
    const reference = { entityId: 'furnace', epoch: 1, lifetime: 2 };
    const furnace = {
      version: 1 as const,
      reference,
      position: [2, 0, 0] as const,
      component: stationContent.stations!.codec.create('furnace', 'furnace'),
    };
    const furnaceActor = {
      ...actor(),
      slots: Array(24).fill(null),
      cursor: {
        version: 1 as const,
        revision: 1,
        stack: { itemId: 'test:ore', count: 1 },
        origin: null,
      },
    };
    expect(() =>
      buildInventoryPointerCandidate(stationContent, {
        actor: furnaceActor,
        station: furnace,
        input: {
          actor: furnaceActor.reference,
          expectedInventoryRevision: 4,
          station: { reference, expectedRevision: 0 },
          command: { kind: 'click', slot: { kind: 'station', slot: 2 }, button: 0 },
        },
      }),
    ).toThrow(/invalid-station-slot/);
    if (furnace.component.kind !== 'furnace') throw new Error('Expected furnace fixture.');
    expect(furnace.component.furnace.output).toBeNull();
  });
});
