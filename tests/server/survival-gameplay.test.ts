import { describe, expect, it } from 'vitest';
import { GameServer } from '../../src/server/game-server';
import { ItemIds } from '../../src/server/gameplay/item-registry';
import { Voxel } from '../../src/world/voxel';

const createPlayerServer = (position: [number, number, number] = [0.5, 34.6, 0.5]) => {
  const server = new GameServer({ seedText: 'survival-rules' });
  server.spawnPlayer({ id: 'player-1', position });
  return server;
};

describe('resource loop', () => {
  it('uses canonical break progress, commits once and spawns the mapped world item', () => {
    const server = createPlayerServer();
    server.edit(1, 33, 0, Voxel.Wood, 'fixture');
    const revisionBeforeBreak = server.worldRevision;

    expect(server.beginBreak('player-1', [1, 33, 0])).toMatchObject({ success: true, requiredSeconds: 1.2 });
    expect(server.advanceGameplayRules(1.19).commits).toHaveLength(0);
    expect(server.getVoxel(1, 33, 0)).toBe(Voxel.Wood);

    const completed = server.advanceGameplayRules(0.01);
    expect(completed.commits).toHaveLength(1);
    expect(completed.commits[0]).toMatchObject({ committed: true, worldRevision: revisionBeforeBreak + 1 });
    expect(server.getVoxel(1, 33, 0)).toBe(Voxel.Air);
    expect(server.queryEntities({ type: 'world-item' })).toEqual([
      expect.objectContaining({ position: [1.5, 33.5, 0.5], stack: { itemId: ItemIds.WoodBlock, count: 1 } }),
    ]);
  });

  it('applies preferred tool speed and cancels stale, changed, distant or released targets', () => {
    const server = createPlayerServer();
    server.giveItem('player-1', { itemId: ItemIds.WoodAxe, count: 1 });
    server.selectHotbarSlot('player-1', 0);
    server.edit(1, 33, 0, Voxel.Wood, 'fixture');

    expect(server.beginBreak('player-1', [1, 33, 0])).toMatchObject({ requiredSeconds: 0.4 });
    server.advanceGameplayRules(0.39);
    expect(server.getVoxel(1, 33, 0)).toBe(Voxel.Wood);
    server.cancelBreak('player-1');
    server.advanceGameplayRules(1);
    expect(server.getVoxel(1, 33, 0)).toBe(Voxel.Wood);

    server.beginBreak('player-1', [1, 33, 0]);
    server.edit(1, 33, 0, Voxel.Stone, 'other-actor');
    server.advanceGameplayRules(1);
    expect(server.getVoxel(1, 33, 0)).toBe(Voxel.Stone);
    expect(server.queryEntities({ type: 'world-item' })).toHaveLength(0);

    server.updateEntity('player-1', { position: [20, 34.6, 0.5] });
    expect(server.beginBreak('player-1', [1, 33, 0])).toMatchObject({ success: false, reason: 'out-of-range' });
  });

  it('picks up only when the whole stack fits and never loses a full-inventory world item', () => {
    const server = createPlayerServer();
    const item = server.spawnWorldItem([1, 34.6, 0.5], { itemId: ItemIds.WoodBlock, count: 2 });
    expect(server.pickupItem('player-1', item.id)).toMatchObject({ success: true });
    expect(server.getInventory('player-1').slots[0]).toEqual({ itemId: ItemIds.WoodBlock, count: 2 });
    expect(server.getEntity(item.id)).toBeNull();

    server.giveItem('player-1', { itemId: ItemIds.WoodAxe, count: 23 });
    const blocked = server.spawnWorldItem([1, 34.6, 0.5], { itemId: ItemIds.StoneBlock, count: 1 });
    expect(server.pickupItem('player-1', blocked.id)).toMatchObject({ success: false, reason: 'inventory-full' });
    expect(server.getEntity(blocked.id)).not.toBeNull();
  });

  it('validates placement before atomically consuming one block item and committing one edit', () => {
    const server = createPlayerServer();
    server.giveItem('player-1', { itemId: ItemIds.DirtBlock, count: 2 });
    server.selectHotbarSlot('player-1', 0);
    server.edit(2, 34, 0, Voxel.Air, 'fixture');
    const revision = server.worldRevision;

    expect(server.placeVoxel('player-1', [2, 34, 0])).toMatchObject({ success: true });
    expect(server.getVoxel(2, 34, 0)).toBe(Voxel.Dirt);
    expect(server.worldRevision).toBe(revision + 1);
    expect(server.getInventory('player-1').slots[0]).toEqual({ itemId: ItemIds.DirtBlock, count: 1 });

    const before = server.getInventory('player-1');
    expect(server.placeVoxel('player-1', [0, 34, 0])).toMatchObject({ success: false, reason: 'player-collision' });
    expect(server.placeVoxel('player-1', [100, 34, 0])).toMatchObject({ success: false, reason: 'out-of-range' });
    expect(server.getInventory('player-1')).toEqual(before);
  });
});

describe('crafting and survival rules', () => {
  it('does not count frame ticks or player synchronization as gameplay events', () => {
    const server = createPlayerServer();
    const before = server.gameplayMetrics().gameplayEventCount;

    for (let frame = 0; frame < 120; frame += 1) {
      server.updateEntity('player-1', { position: [0.5 + frame / 10_000, 34.6, 0.5] });
      server.advanceGameplayRules(1 / 60);
    }

    expect(server.gameplayMetrics().gameplayEventCount).toBe(before);
    server.giveItem('player-1', { itemId: ItemIds.Berry, count: 1 });
    expect(server.gameplayMetrics().gameplayEventCount).toBe(before + 1);
  });

  it('crafts through the server rule and changes selected tool mining speed', () => {
    const server = createPlayerServer();
    server.giveItem('player-1', { itemId: ItemIds.WoodBlock, count: 1 });
    expect(server.craft('player-1', 'planks')).toMatchObject({ success: true });
    expect(server.craft('player-1', 'wood-axe')).toMatchObject({ success: true });
    expect(server.getInventory('player-1').slots).toContainEqual({ itemId: ItemIds.WoodAxe, count: 1 });
  });

  it('makes long and sliced gameplay ticks produce identical hunger, healing and starvation', () => {
    const long = createPlayerServer();
    const sliced = createPlayerServer();
    long.applyDamage('system', 'player-1', 4, 'test');
    sliced.applyDamage('system', 'player-1', 4, 'test');

    long.advanceGameplayRules(240);
    for (let second = 0; second < 240; second += 1) sliced.advanceGameplayRules(1);
    expect(long.getPlayerState('player-1')).toEqual(sliced.getPlayerState('player-1'));

    long.setHungerForDebug('player-1', 0);
    sliced.setHungerForDebug('player-1', 0);
    long.advanceGameplayRules(30);
    for (let second = 0; second < 30; second += 1) sliced.advanceGameplayRules(1);
    expect(long.getPlayerState('player-1')).toEqual(sliced.getPlayerState('player-1'));
  });

  it('consumes food only when it can restore hunger', () => {
    const server = createPlayerServer();
    server.giveItem('player-1', { itemId: ItemIds.Berry, count: 2 });
    expect(server.useSelectedItem('player-1')).toMatchObject({ success: false, reason: 'hunger-full' });
    expect(server.getInventory('player-1').slots[0]).toEqual({ itemId: ItemIds.Berry, count: 2 });
    server.setHungerForDebug('player-1', 17);
    expect(server.useSelectedItem('player-1')).toMatchObject({ success: true });
    expect(server.getPlayerState('player-1').hunger).toBe(20);
    expect(server.getInventory('player-1').slots[0]).toEqual({ itemId: ItemIds.Berry, count: 1 });
  });
});

describe('combat, death and respawn', () => {
  it('rejects an entity attack through a solid wall and allows it after the wall is removed', () => {
    const server = createPlayerServer();
    const creature = server.spawnEntity({ type: 'creature', position: [2.5, 34.6, 0.5], health: 12, maxHealth: 12 });
    server.edit(1, 34, 0, Voxel.Stone, 'fixture');
    server.edit(1, 35, 0, Voxel.Stone, 'fixture');

    expect(server.attackEntity('player-1', creature.id)).toMatchObject({ success: false, reason: 'blocked' });
    expect(server.getEntity(creature.id)).toMatchObject({ health: 12 });

    server.edit(1, 34, 0, Voxel.Air, 'fixture');
    server.edit(1, 35, 0, Voxel.Air, 'fixture');
    expect(server.attackEntity('player-1', creature.id)).toMatchObject({ success: true, damage: 4 });
    expect(server.getEntity(creature.id)).toMatchObject({ health: 8 });
    expect(server.attackEntity('player-1', creature.id)).toMatchObject({ success: false, reason: 'cooldown' });

    server.advanceGameplayRules(0.5);
    server.updateEntity(creature.id, { position: [20, 34.6, 0.5] });
    expect(server.attackEntity('player-1', creature.id)).toMatchObject({ success: false, reason: 'out-of-range' });
  });

  it('enforces target range and cooldown before applying damage', () => {
    const server = createPlayerServer();
    const creature = server.spawnEntity({ type: 'creature', position: [2, 34.6, 0.5], health: 12, maxHealth: 12 });
    expect(server.attackEntity('player-1', creature.id)).toMatchObject({ success: true, damage: 4 });
    expect(server.getEntity(creature.id)).toMatchObject({ health: 8 });
    expect(server.attackEntity('player-1', creature.id)).toMatchObject({ success: false, reason: 'cooldown' });
    server.advanceGameplayRules(0.5);
    expect(server.attackEntity('player-1', creature.id)).toMatchObject({ success: true });
    server.updateEntity(creature.id, { position: [20, 34.6, 0.5] });
    server.advanceGameplayRules(0.5);
    expect(server.attackEntity('player-1', creature.id)).toMatchObject({ success: false, reason: 'out-of-range' });
  });

  it('drops the full inventory on death, disables interaction and respawns without restoring drops', () => {
    const server = createPlayerServer();
    server.giveItem('player-1', { itemId: ItemIds.WoodBlock, count: 3 });
    server.giveItem('player-1', { itemId: ItemIds.Berry, count: 2 });
    server.applyDamage('system', 'player-1', 20, 'test');

    expect(server.getPlayerState('player-1')).toMatchObject({ lifecycle: 'dead', health: 0 });
    expect(server.getInventory('player-1').slots.every((slot) => slot === null)).toBe(true);
    expect(server.queryEntities({ type: 'world-item' }).map((entity) => entity.stack)).toEqual(
      expect.arrayContaining([
        { itemId: ItemIds.WoodBlock, count: 3 },
        { itemId: ItemIds.Berry, count: 2 },
      ]),
    );
    expect(server.beginBreak('player-1', [1, 33, 0])).toMatchObject({ success: false, reason: 'player-dead' });
    expect(server.respawnPlayer('player-1')).toMatchObject({ success: true });
    expect(server.getPlayerState('player-1')).toMatchObject({ lifecycle: 'alive', health: 20, hunger: 20 });
    expect(server.getEntity('player-1')?.position).toEqual([0.5, 34.6, 0.5]);
    expect(server.queryEntities({ type: 'world-item' })).toHaveLength(2);
  });
});
