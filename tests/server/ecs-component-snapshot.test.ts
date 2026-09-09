import { describe, expect, it } from 'vitest';
import {
  EntityStore,
  type EntityStoreComponentSnapshot,
} from '../../packages/game-core/src/server/gameplay/entity-store';
import { ItemIds } from '../../packages/game-core/src/server/gameplay/item-registry';
import { GameplayRuntime } from '../../packages/game-core/src/server/gameplay/gameplay-runtime';
import { testCorePlatform } from '../support/core-platform';

const populatedStore = () => {
  const store = new EntityStore();
  store.spawn({ id: 'player', type: 'player', position: [1, 8, 1] });
  store.spawn({ id: 'settler', type: 'npc', archetype: 'settler', position: [3, 8, 1], health: 17, maxHealth: 20 });
  store.spawn({ id: 'retired-before-save', type: 'creature', position: [9, 8, 1] });
  store.despawn('retired-before-save');

  const player = store.playerStateAccess('player');
  player.health = 14;
  player.hunger = 11;
  player.hungerAccumulator = 7;
  player.healingAccumulator = 3;
  player.starvationAccumulator = 2;
  player.spawnPosition = [5, 9, 5];
  player.breakAction = { position: [6, 8, 5], voxel: 3, elapsedSeconds: 0.4, requiredSeconds: 1.2 };
  player.inventory.add({ itemId: ItemIds.WoodBlock, count: 4 });
  player.selectSlot(2);

  const settler = store.actorStateAccess('settler');
  settler.hunger = 42;
  settler.inventory.add({ itemId: ItemIds.Berry, count: 3 });
  settler.selectSlot(1);
  return store;
};

describe('EntityStore component checkpoint', () => {
  it('roundtrips domain lifetimes, allocator state and all player/NPC facets without raw ECS ids', () => {
    const store = populatedStore();
    const oldReference = store.createReference('player')!;
    const saved = store.exportComponentSnapshot();
    const encoded = JSON.stringify(saved);

    expect(encoded).not.toMatch(/"eid"|componentRef|\$internal/i);
    expect(saved.issuedIds).toContain('retired-before-save');

    const generated = store.spawn({ type: 'creature', position: [20, 8, 0] });
    store.despawn(generated.id);
    store.restoreComponentSnapshot(saved);

    const currentReference = store.createReference('player')!;
    expect(currentReference.lifetime).toBe(oldReference.lifetime);
    expect(currentReference.epoch).toBeGreaterThan(oldReference.epoch);
    expect(store.resolveReference(oldReference)).toBeNull();
    expect(store.playerStateAccess('player')).toMatchObject({
      health: 14,
      hunger: 11,
      selectedSlot: 2,
      spawnPosition: [5, 9, 5],
      breakAction: { position: [6, 8, 5], voxel: 3, elapsedSeconds: 0.4, requiredSeconds: 1.2 },
    });
    expect(store.playerStateAccess('player').inventory.snapshot()[0]).toEqual({
      itemId: ItemIds.WoodBlock,
      count: 4,
    });
    expect(store.actorStateAccess('settler')).toMatchObject({ health: 17, hunger: 42, selectedSlot: 1 });
    expect(store.actorStateAccess('settler').inventory.snapshot()[0]).toEqual({ itemId: ItemIds.Berry, count: 3 });
    expect(() => store.spawn({ id: 'retired-before-save', type: 'creature', position: [0, 8, 0] })).toThrow(
      /issued|retired/i,
    );
    expect(() => store.spawn({ id: generated.id, type: 'creature', position: [0, 8, 0] })).toThrow(/issued|retired/i);
    expect(store.spawn({ type: 'creature', position: [21, 8, 0] }).id).not.toBe(generated.id);
  });

  it('rejects malformed component facets before replacing the live owner', () => {
    const store = populatedStore();
    const before = store.exportComponentSnapshot();
    const reference = store.createReference('settler')!;
    const malformed = structuredClone(before) as EntityStoreComponentSnapshot;
    const settler = malformed.actors.find((actor) => actor.entityId === 'settler')!;
    settler.inventory[0] = { itemId: 'unknown-item', count: 1 } as never;

    expect(() => store.restoreComponentSnapshot(malformed)).toThrow(/item|inventory/i);
    expect(store.exportComponentSnapshot()).toEqual(before);
    expect(store.resolveReference(reference)?.id).toBe('settler');
    expect(store.actorStateAccess('settler').inventory.snapshot()[0]).toEqual({ itemId: ItemIds.Berry, count: 3 });
  });
});

describe('GameplaySnapshot V4 component codec', () => {
  it('writes V4 without a duplicate players array and restores NPC inventory before simulation bindings', () => {
    const runtime = new GameplayRuntime({
      getVoxel: () => 0,
      prepareVoxelEdit: () => ({ committed: false }) as never,
      getWorldTime: () => 9,
      platform: testCorePlatform,
    });
    runtime.spawnPlayer({ id: 'player', position: [1, 8, 1] });
    runtime.spawnAutonomous(
      { id: 'settler', type: 'npc', archetype: 'settler', position: [3, 8, 1], health: 18, maxHealth: 20 },
      { archetype: 'settler', hunger: 41 },
    );
    runtime.giveItem('player', { itemId: ItemIds.WoodBlock, count: 2 });
    runtime.giveItem('settler', { itemId: ItemIds.Berry, count: 3 });
    runtime.setHungerForDebug('player', 12);
    const reference = runtime.entities.createReference('settler')!;
    const snapshot = runtime.createSnapshot();

    expect(snapshot).toMatchObject({ version: 4, entityStore: { version: 1 } });
    expect(snapshot).not.toHaveProperty('players');
    expect(runtime.restoreSnapshot(snapshot)).toEqual({ version: 4, worldTime: 9 });
    expect(runtime.entities.createReference('settler')).toMatchObject({ lifetime: reference.lifetime });
    expect(runtime.entities.createReference('settler')!.epoch).toBeGreaterThan(reference.epoch);
    expect(runtime.getInventory('player').slots[0]).toEqual({ itemId: ItemIds.WoodBlock, count: 2 });
    expect(runtime.getInventory('settler').slots[0]).toEqual({ itemId: ItemIds.Berry, count: 3 });
    expect(runtime.simulation.getActor('settler')).toMatchObject({ hunger: 41 });
  });

  it('leaves the complete live component and simulation state unchanged when V4 validation fails', () => {
    const runtime = new GameplayRuntime({
      getVoxel: () => 0,
      prepareVoxelEdit: () => ({ committed: false }) as never,
      getWorldTime: () => 9,
      platform: testCorePlatform,
    });
    runtime.spawnPlayer({ id: 'player', position: [1, 8, 1] });
    runtime.giveItem('player', { itemId: ItemIds.Berry, count: 2 });
    const reference = runtime.entities.createReference('player')!;
    const before = runtime.createSnapshot();
    const malformed = structuredClone(before);
    malformed.entityStore.actors = [];

    expect(() => runtime.restoreSnapshot(malformed)).toThrow(/actor component|gameplay snapshot/i);
    expect(runtime.createSnapshot()).toEqual(before);
    expect(runtime.entities.resolveReference(reference)?.id).toBe('player');
    expect(runtime.getInventory('player').slots[0]).toEqual({ itemId: ItemIds.Berry, count: 2 });
  });
});
