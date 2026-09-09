import { describe, expect, it } from 'vitest';
import { GameplayRuntime } from '../../packages/game-core/src/server/gameplay/gameplay-runtime';
import { testCorePlatform } from '../support/core-platform';

function setup() {
  const world = new GameplayRuntime({
    platform: testCorePlatform,
    getWorldTime: () => 0,
    getVoxel: () => 0,
    prepareVoxelEdit: () => {
      throw new Error('unexpected world edit');
    },
  });
  world.spawnPlayer({ id: 'alice', position: [0, 1, 0] });
  world.giveItem('alice', { itemId: 'wood-block', count: 3 });
  return world;
}

describe('actual player vitals transaction', () => {
  it('rejects lethal damage before changing health, inventory or lifecycle when drops cannot allocate', () => {
    const world = setup();
    const exhausted = world.createSnapshot();
    exhausted.entityStore.sequence = Number.MAX_SAFE_INTEGER;
    world.restoreSnapshot(exhausted);
    const before = world.createSnapshot();
    expect(() => world.applyDamage('test', 'alice', 20, 'test')).toThrow(/sequence.*exhausted/i);
    expect(world.createSnapshot()).toEqual(before);
  });
  it('rejects starvation death before writing need accumulators and actor state', () => {
    const world = setup();
    world.applyDamage('test', 'alice', 19, 'test');
    world.setHungerForDebug('alice', 0);
    world.advanceRules(14);
    const exhausted = world.createSnapshot();
    exhausted.entityStore.sequence = Number.MAX_SAFE_INTEGER;
    world.restoreSnapshot(exhausted);
    const before = world.createSnapshot().entityStore;
    expect(() => world.advanceRules(1)).toThrow(/sequence.*exhausted/i);
    expect(world.createSnapshot().entityStore).toEqual(before);
  });
  it('keeps a killed NPC entity and registration when its drop allocation fails', () => {
    const world = setup();
    world.giveItem('alice', { itemId: 'wood-sword', count: 1 });
    world.selectHotbarSlot('alice', 1);
    world.spawnAutonomous(
      { id: 'grazer', type: 'creature', archetype: 'grazer', position: [1, 1, 0], health: 1, maxHealth: 12 },
      { archetype: 'grazer' },
    );
    expect(world.attackEntity('alice', 'grazer')).toMatchObject({ success: true });
    const exhausted = world.createSnapshot();
    exhausted.entityStore.sequence = Number.MAX_SAFE_INTEGER;
    world.restoreSnapshot(exhausted);
    const entity = world.getEntity('grazer');
    const actor = world.simulation.getActor('grazer');
    expect(() => world.advanceRules(0.2)).toThrow(/sequence.*exhausted/i);
    expect(world.getEntity('grazer')).toEqual(entity);
    expect(world.simulation.getActor('grazer')).toEqual(actor);
    expect(world.queryEntities({ type: 'world-item' })).toEqual([]);
  });
  it('caps healing at maximum health after fractional damage', () => {
    const world = setup();
    world.applyDamage('test', 'alice', 0.5, 'test');
    world.advanceRules(10);
    expect(world.getPlayerState('alice').health).toBe(20);
  });
  it('commits lethal health, cleared inventory and drops once', () => {
    const world = setup();
    const revision = world.gameplayRevision;
    expect(world.applyDamage('test', 'alice', 20, 'test')).toEqual({ success: true });
    expect(world.gameplayRevision).toBe(revision + 1);
    expect(world.getPlayerState('alice')).toMatchObject({ health: 0, lifecycle: 'dead', breakAction: null });
    expect(world.getInventory('alice').slots.every((slot) => slot === null)).toBe(true);
    expect(world.queryEntities({ type: 'world-item' })).toMatchObject([{ stack: { itemId: 'wood-block', count: 3 } }]);
  });
});
