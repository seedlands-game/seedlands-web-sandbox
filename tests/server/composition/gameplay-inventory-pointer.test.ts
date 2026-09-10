import { describe, expect, it } from 'vitest';
import {
  assembleOverworldPacks,
  createGameplayActorAuthority,
  createGameplaySystemAuthority,
} from '@seedlands/game-core/server/composition/host-api';
import { GameplayRuntime } from '../../../packages/game-core/src/server/gameplay/gameplay-runtime';
import type {
  InventoryPointerCommand,
  InventoryPointerInputV1,
} from '../../../packages/game-core/src/server/gameplay/modules/inventory-pointer-model';
import { pack } from '../../../packages/game-core/src/server/gameplay/playbooks/overworld/pack';
import { projectNearbyStations } from '../../../packages/game-core/src/server/gameplay/station-player-view';
import { testCorePlatform } from '../../support/core-platform';

function workbench(world: GameplayRuntime) {
  const station = world.entities.stationSnapshot('workbench');
  if (station?.kind !== 'workbench') throw new Error('Expected workbench fixture.');
  return station;
}

function setup() {
  const composition = assembleOverworldPacks([
    {
      ...pack,
      integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
    },
  ]);
  const actorAuthority = createGameplayActorAuthority(composition.resources, { playerAlias: 'human' });
  const world = new GameplayRuntime({
    composition,
    moduleActorAuthority: actorAuthority,
    moduleSystemAuthority: createGameplaySystemAuthority(composition),
    platform: testCorePlatform,
    getVoxel: ([x, y, z]) => (x === 2 && y === 0 && z === 0 ? 11 : 0),
    getWorldTime: () => 9,
    prepareVoxelEdit: () => {
      throw new Error('unexpected voxel edit');
    },
  });
  world.spawnPlayer({ id: 'alice', position: [0.5, 0, 0.5] });
  world.entities.spawn({ id: 'workbench', type: 'station', position: [2, 0, 0], station: { kind: 'workbench' } });
  const pointer = (command: InventoryPointerCommand, station = false, revision?: number) => {
    const view = world.getInventoryPointerView('alice');
    const input: InventoryPointerInputV1 = {
      actor: view.actor,
      expectedInventoryRevision: revision ?? view.revision,
      ...(station
        ? {
            station: {
              reference: world.entities.createReference('workbench')!,
              expectedRevision: world.entities.stationSnapshot('workbench')!.revision,
            },
          }
        : {}),
      command,
    };
    return world.inventoryPointer('alice', input);
  };
  return { world, pointer, actorAuthority };
}

describe('registered inventory pointer owner', () => {
  it('commits split, distribution, collection, hotbar exchange and stale denial against one stable revision', () => {
    const { world, pointer } = setup();
    world.giveItem('alice', { itemId: 'plank', count: 9 });
    const firstRevision = world.getInventoryPointerView('alice').revision;
    expect(pointer({ kind: 'click', slot: { kind: 'inventory', slot: 0 }, button: 2 })).toMatchObject({
      success: true,
    });
    expect(world.getInventoryPointerView('alice')).toMatchObject({
      revision: firstRevision + 1,
      cursor: { stack: { itemId: 'plank', count: 5 }, origin: { kind: 'inventory', slot: 0 } },
    });
    expect(world.getInventory('alice').slots[0]).toEqual({ itemId: 'plank', count: 4 });
    const afterSplit = world.createSnapshot();
    expect(
      pointer({ kind: 'click', slot: { kind: 'inventory', slot: 1 }, button: 2 }, false, firstRevision).success,
    ).toBe(false);
    expect(world.createSnapshot()).toEqual(afterSplit);

    expect(
      pointer({
        kind: 'distribute',
        button: 2,
        targets: [1, 2, 2].map((slot) => ({ kind: 'inventory' as const, slot })),
      }),
    ).toMatchObject({ success: true });
    expect(pointer({ kind: 'collect', slot: { kind: 'inventory', slot: 0 } })).toMatchObject({ success: true });
    expect(world.getInventoryPointerView('alice').cursor.stack).toEqual({ itemId: 'plank', count: 9 });
    expect(pointer({ kind: 'click', slot: { kind: 'inventory', slot: 8 }, button: 0 })).toMatchObject({
      success: true,
    });
    expect(pointer({ kind: 'hotbar', slot: { kind: 'inventory', slot: 8 }, hotbarSlot: 2 })).toMatchObject({
      success: true,
    });
    expect(world.getInventory('alice').slots[2]).toEqual({ itemId: 'plank', count: 9 });
  });

  it('crafts a real station result into an origin-free cursor and closes it into the bag', () => {
    const { world, pointer } = setup();
    world.giveItem('alice', { itemId: 'plank', count: 5 });
    expect(pointer({ kind: 'click', slot: { kind: 'inventory', slot: 0 }, button: 0 })).toMatchObject({
      success: true,
    });
    expect(
      pointer(
        {
          kind: 'distribute',
          button: 2,
          targets: [0, 1, 2, 4, 7].map((slot) => ({ kind: 'station' as const, slot })),
        },
        true,
      ),
    ).toMatchObject({ success: true });
    expect(pointer({ kind: 'craft', batch: false }, true)).toMatchObject({ success: true, value: { crafted: 1 } });
    expect(world.getInventoryPointerView('alice').cursor).toMatchObject({
      stack: { itemId: 'wood-pickaxe', count: 1, instance: { durability: 60 } },
      origin: null,
    });
    expect(pointer({ kind: 'close' })).toMatchObject({ success: true });
    expect(world.getInventoryPointerView('alice').cursor.stack).toBeNull();
    expect(world.getInventory('alice').slots).toContainEqual({
      itemId: 'wood-pickaxe',
      count: 1,
      instance: { durability: 60 },
    });
    expect(workbench(world).grid.every((slot) => slot === null)).toBe(true);
  });

  it('quick-moves to a station, takes from it without shared aliases, and batch crafts to the bag', () => {
    const first = setup();
    first.world.giveItem('alice', { itemId: 'plank', count: 4 });
    expect(first.pointer({ kind: 'quick-move', slot: { kind: 'inventory', slot: 0 } }, true)).toMatchObject({
      success: true,
    });
    expect(first.pointer({ kind: 'click', slot: { kind: 'station', slot: 0 }, button: 2 }, true)).toMatchObject({
      success: true,
    });
    expect(first.world.getInventoryPointerView('alice').cursor).toMatchObject({
      stack: { itemId: 'plank', count: 2 },
      origin: { kind: 'station', slot: 0 },
    });
    expect(first.pointer({ kind: 'close' })).toMatchObject({ success: true });
    expect(first.world.getInventory('alice').slots[0]).toEqual({ itemId: 'plank', count: 2 });
    expect(workbench(first.world).grid[0]).toEqual({ itemId: 'plank', count: 2 });

    const batch = setup();
    batch.world.giveItem('alice', { itemId: 'plank', count: 10 });
    batch.pointer({ kind: 'click', slot: { kind: 'inventory', slot: 0 }, button: 0 });
    expect(
      batch.pointer(
        {
          kind: 'distribute',
          button: 0,
          targets: [0, 1, 2, 4, 7].map((slot) => ({ kind: 'station' as const, slot })),
        },
        true,
      ),
    ).toMatchObject({ success: true });
    expect(batch.pointer({ kind: 'craft', batch: true }, true)).toMatchObject({
      success: true,
      value: { crafted: 2 },
    });
    expect(batch.world.getInventory('alice').slots.filter((stack) => stack?.itemId === 'wood-pickaxe')).toHaveLength(2);
    expect(batch.world.getInventoryPointerView('alice').cursor.stack).toBeNull();
    expect(workbench(batch.world).grid.every((slot) => slot === null)).toBe(true);
  });

  it('projects matched results and crafts into an empty or compatible cursor when the bag is full', () => {
    const projected = (fixture: ReturnType<typeof setup>) =>
      projectNearbyStations(fixture.world, 'alice', fixture.actorAuthority, (x, y, z) =>
        x === 2 && y === 0 && z === 0 ? 11 : 0,
      )[0]!;

    const emptyCursor = setup();
    emptyCursor.world.giveItem('alice', { itemId: 'plank', count: 5 });
    emptyCursor.pointer({ kind: 'click', slot: { kind: 'inventory', slot: 0 }, button: 0 });
    emptyCursor.pointer(
      {
        kind: 'distribute',
        button: 2,
        targets: [0, 1, 2, 4, 7].map((slot) => ({ kind: 'station' as const, slot })),
      },
      true,
    );
    expect(emptyCursor.world.giveItem('alice', { itemId: 'wood-block', count: 24 * 64 })).toMatchObject({
      success: true,
    });
    expect(projected(emptyCursor)).toMatchObject({
      matchedRecipeIds: ['wood-pickaxe'],
      craftableRecipeIds: [],
    });
    expect(emptyCursor.pointer({ kind: 'craft', batch: false }, true)).toMatchObject({ success: true });
    expect(emptyCursor.world.getInventoryPointerView('alice').cursor.stack).toMatchObject({
      itemId: 'wood-pickaxe',
      count: 1,
    });

    const compatibleCursor = setup();
    compatibleCursor.world.giveItem('alice', { itemId: 'plank', count: 8 });
    compatibleCursor.pointer({ kind: 'click', slot: { kind: 'inventory', slot: 0 }, button: 0 });
    compatibleCursor.pointer(
      {
        kind: 'distribute',
        button: 2,
        targets: [0, 1, 2, 3, 5, 6, 7, 8].map((slot) => ({ kind: 'station' as const, slot })),
      },
      true,
    );
    compatibleCursor.world.giveItem('alice', { itemId: 'chest', count: 1 });
    compatibleCursor.pointer({ kind: 'click', slot: { kind: 'inventory', slot: 0 }, button: 0 });
    compatibleCursor.world.giveItem('alice', { itemId: 'wood-block', count: 24 * 64 });
    expect(projected(compatibleCursor)).toMatchObject({ matchedRecipeIds: ['chest'], craftableRecipeIds: [] });
    expect(compatibleCursor.pointer({ kind: 'craft', batch: false }, true)).toMatchObject({ success: true });
    expect(compatibleCursor.world.getInventoryPointerView('alice').cursor.stack).toEqual({ itemId: 'chest', count: 2 });
  });

  it('saves an owned cursor and drops it exactly once on player death before respawn', () => {
    const first = setup();
    first.world.giveItem('alice', { itemId: 'plank', count: 9 });
    first.pointer({ kind: 'click', slot: { kind: 'inventory', slot: 0 }, button: 2 });
    const saved = first.world.createSnapshot();
    const restored = setup();
    restored.world.restoreSnapshot(saved);
    expect(restored.world.getInventoryPointerView('alice').cursor.stack).toEqual({ itemId: 'plank', count: 5 });

    expect(restored.world.applyDamage('test', 'alice', 20, 'test')).toEqual({ success: true });
    expect(restored.world.getInventoryPointerView('alice').cursor.stack).toBeNull();
    expect(restored.world.getInventory('alice').slots.every((slot) => slot === null)).toBe(true);
    const dropped = restored.world.entities
      .query({ type: 'world-item' })
      .reduce((count, entity) => count + (entity.stack?.itemId === 'plank' ? entity.stack.count : 0), 0);
    expect(dropped).toBe(9);
    expect(restored.world.respawnPlayer('alice')).toEqual({ success: true });
    expect(restored.world.getInventoryPointerView('alice').cursor.stack).toBeNull();
    expect(
      restored.world.entities
        .query({ type: 'world-item' })
        .reduce((count, entity) => count + (entity.stack?.itemId === 'plank' ? entity.stack.count : 0), 0),
    ).toBe(9);
  });

  it('preserves cursor ownership when an automatic pickup advances the inventory revision before close', () => {
    const { world, pointer } = setup();
    world.giveItem('alice', { itemId: 'plank', count: 9 });
    pointer({ kind: 'click', slot: { kind: 'inventory', slot: 0 }, button: 2 });
    expect(pointer({ kind: 'drop', button: 2 })).toMatchObject({ success: true });
    const staleCloseRevision = world.getInventoryPointerView('alice').revision;
    const drop = world.entities.query({ type: 'world-item' })[0]!;
    expect(world.pickupItem('alice', drop.id)).toEqual({ success: true });
    const afterPickup = world.createSnapshot();
    expect(pointer({ kind: 'close' }, false, staleCloseRevision).success).toBe(false);
    expect(world.createSnapshot()).toEqual(afterPickup);
    expect(pointer({ kind: 'close' })).toMatchObject({ success: true });
    expect(world.getInventoryPointerView('alice').cursor.stack).toBeNull();
    expect(
      world
        .getInventory('alice')
        .slots.reduce((count, stack) => count + (stack?.itemId === 'plank' ? stack.count : 0), 0),
    ).toBe(9);
    expect(world.entities.query({ type: 'world-item' })).toHaveLength(0);
  });

  it('migrates a pre-cursor V4 actor facet without admitting malformed cursor state', () => {
    const source = setup();
    source.world.giveItem('alice', { itemId: 'plank', count: 2 });
    const legacy = source.world.createSnapshot();
    const actor = legacy.entityStore.actors.find((entry) => entry.entityId === 'alice')! as {
      inventoryRevision?: number;
      inventoryCursor?: unknown;
    };
    delete actor.inventoryRevision;
    delete actor.inventoryCursor;
    const restored = setup();
    expect(restored.world.restoreSnapshot(legacy)).toEqual({ version: 4, worldTime: 9 });
    expect(restored.world.getInventoryPointerView('alice')).toMatchObject({ revision: 0, cursor: { stack: null } });

    const invalid = restored.world.createSnapshot();
    const invalidActor = invalid.entityStore.actors.find((entry) => entry.entityId === 'alice')! as {
      inventoryCursor?: unknown;
    };
    invalidActor.inventoryCursor = {
      version: 1,
      revision: 1,
      stack: null,
      origin: { kind: 'inventory', slot: 0 },
    };
    const before = restored.world.createSnapshot();
    expect(() => restored.world.restoreSnapshot(invalid)).toThrow(/cursor/i);
    expect(restored.world.createSnapshot()).toEqual(before);
  });

  it('settles the cursor through the registered mode transition and rejects another bound actor', () => {
    const { world, pointer, actorAuthority } = setup();
    world.giveItem('alice', { itemId: 'plank', count: 9 });
    pointer({ kind: 'click', slot: { kind: 'inventory', slot: 0 }, button: 2 });
    const binding = actorAuthority.forActor('alice', 'player')!;
    const modes = world.bindModuleOperations(binding.authorizer, {
      moduleId: 'seedlands:mode-module',
      principalId: binding.principalId,
      originalActorId: 'alice',
    });
    expect(
      modes.invoke({
        operationId: 'seedlands:set-mode',
        target: { kind: 'entity', entityId: 'alice' },
        input: { mode: 'creative' },
      }),
    ).toMatchObject({ ok: true });
    expect(world.getInventoryPointerView('alice').cursor.stack).toBeNull();
    expect(
      world
        .getInventory('alice')
        .slots.reduce((count, stack) => count + (stack?.itemId === 'plank' ? stack.count : 0), 0),
    ).toBe(9);

    world.spawnPlayer({ id: 'bob', position: [0.5, 0, 1.5] });
    const before = world.createSnapshot();
    const alice = world.getInventoryPointerView('alice');
    expect(
      world.inventoryPointer('bob', {
        actor: alice.actor,
        expectedInventoryRevision: alice.revision,
        command: { kind: 'close' },
      }).success,
    ).toBe(false);
    expect(world.createSnapshot()).toEqual(before);
    modes.dispose();
  });
});
