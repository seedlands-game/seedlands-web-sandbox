import { describe, expect, it } from 'vitest';
import { GameplayRuntime } from '../../packages/game-core/src/server/gameplay/gameplay-runtime';
import { Voxel } from '../../packages/game-core/src/world/voxel';
import { testCorePlatform } from '../support/core-platform';

const createRuntime = () =>
  new GameplayRuntime({
    getVoxel: () => Voxel.Air,
    prepareVoxelEdit: () => {
      throw new Error('Unexpected world edit');
    },
    getWorldTime: () => 9,
    platform: testCorePlatform,
  });

describe('shared actor components', () => {
  it('projects player health from the same owner used by entity health writes and survival rules', () => {
    const runtime = createRuntime();
    runtime.spawnPlayer({ id: 'player', position: [0, 1, 0] });
    expect(runtime.getEntity('player')).toMatchObject({ health: 20, maxHealth: 20 });
    runtime.updateEntity('player', { health: 12 });
    expect(runtime.getPlayerState('player').health).toBe(12);
    runtime.advanceRules(10);
    expect(runtime.getPlayerState('player').health).toBe(13);
    expect(runtime.getEntity('player')?.health).toBe(13);
  });

  it('lets players and NPCs use the same inventory operations without leaking mutable projections', () => {
    const runtime = createRuntime();
    runtime.spawnPlayer({ id: 'player', position: [0, 1, 0] });
    runtime.spawnAutonomous(
      { id: 'npc', type: 'npc', archetype: 'settler', position: [2, 1, 0] },
      { archetype: 'settler' },
    );
    for (const id of ['player', 'npc']) {
      expect(runtime.giveItem(id, { itemId: 'berry', count: 3 }).success).toBe(true);
      const projection = runtime.getInventory(id);
      projection.slots[0]!.count = 99;
      expect(runtime.getInventory(id).slots[0]).toEqual({ itemId: 'berry', count: 3 });
      expect(runtime.removeItem(id, { itemId: 'berry', count: 2 }).success).toBe(true);
      expect(runtime.getInventory(id).slots[0]).toEqual({ itemId: 'berry', count: 1 });
    }
  });

  it('isolates identical actor IDs in separate runtime worlds', () => {
    const first = createRuntime();
    const second = createRuntime();
    for (const runtime of [first, second]) runtime.spawnPlayer({ id: 'player', position: [0, 1, 0] });
    first.updateEntity('player', { health: 8 });
    first.giveItem('player', { itemId: 'berry', count: 2 });
    expect(second.getPlayerState('player').health).toBe(20);
    expect(second.getInventory('player').slots.every((slot) => slot === null)).toBe(true);
  });

  it('uses one needs value for autonomous rules, consumption and actor projections', () => {
    const runtime = createRuntime();
    runtime.spawnAutonomous(
      { id: 'npc', type: 'npc', archetype: 'settler', position: [2, 1, 0] },
      { archetype: 'settler', hunger: 80 },
    );
    runtime.giveItem('npc', { itemId: 'berry', count: 1 });
    expect(runtime.useInventoryItem('npc', 0).success).toBe(true);
    expect(runtime.simulation.getActor('npc')?.hunger).toBe(76);
    runtime.advanceRules(5);
    expect(runtime.simulation.getActor('npc')?.hunger).toBe(77);
    expect(runtime.entities.actorStateAccess('npc').hunger).toBe(77);
  });

  it('awards a nearby drop to exactly one actor through the same pickup path', () => {
    const runtime = createRuntime();
    runtime.spawnPlayer({ id: 'player', position: [0, 1, 0] });
    runtime.spawnAutonomous(
      { id: 'npc', type: 'npc', archetype: 'settler', position: [1, 1, 0] },
      { archetype: 'settler' },
    );
    const drop = runtime.spawnWorldItem([0.5, 1, 0], { itemId: 'berry', count: 1 });
    expect(runtime.pickupItem('npc', drop.id).success).toBe(true);
    expect(runtime.pickupItem('player', drop.id)).toEqual({ success: false, reason: 'invalid-item' });
    expect(runtime.getInventory('npc').slots[0]).toEqual({ itemId: 'berry', count: 1 });
    expect(runtime.getInventory('player').slots.every((slot) => slot === null)).toBe(true);
    expect(runtime.getEntity(drop.id)).toBeNull();
  });

  it('revokes retained component and inventory handles on removal and restore', () => {
    const runtime = createRuntime();
    runtime.spawnPlayer({ id: 'player', position: [0, 1, 0] });
    const beforeRestore = runtime.entities.actorStateAccess('player');
    const oldInventory = beforeRestore.inventory;
    const checkpoint = runtime.createSnapshot();
    runtime.restoreSnapshot(checkpoint);
    expect(() => oldInventory.add({ itemId: 'berry', count: 1 })).toThrow(/stale|reference|epoch/i);
    expect(() => {
      beforeRestore.health = 1;
    }).toThrow(/stale|reference|epoch/i);
    const beforeRemoval = runtime.entities.actorStateAccess('player');
    runtime.despawnEntity('player');
    expect(() => beforeRemoval.inventory.snapshot()).toThrow(/stale|reference|epoch/i);
  });

  it('can keep spawning after restoring an older allocator frontier without recycling retired IDs', () => {
    const runtime = createRuntime();
    runtime.spawnPlayer({ id: 'player', position: [0, 1, 0] });
    const checkpoint = runtime.createSnapshot();
    const retired = runtime.spawnWorldItem([1, 1, 0], { itemId: 'berry', count: 1 });
    runtime.despawnEntity(retired.id);
    runtime.restoreSnapshot(checkpoint);
    const created = runtime.spawnWorldItem([1, 1, 0], { itemId: 'berry', count: 1 });
    expect(created.id).not.toBe(retired.id);
  });
});
