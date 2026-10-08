/** Deterministic Classic armor death, drop, restore, and respawn closure. */
import { expect, it } from 'vitest';
import { Voxel } from '@seedlands/stdlib/world/voxel';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { classicOptions, GameplayRuntime } from '../../../../fixtures/classic/content';

// Literal compatibility oracle shared with the armor acceptance matrix. Each
// row independently proves that the equipped piece survives the lethal hit
// with exactly one point of wear before the death policy drops it.
const classicArmorMatrix = [
  { id: 'leather-helmet', slot: 'helmet' },
  { id: 'leather-chestplate', slot: 'chestplate' },
  { id: 'leather-leggings', slot: 'leggings' },
  { id: 'leather-boots', slot: 'boots' },
  { id: 'iron-helmet', slot: 'helmet' },
  { id: 'iron-chestplate', slot: 'chestplate' },
  { id: 'iron-leggings', slot: 'leggings' },
  { id: 'iron-boots', slot: 'boots' },
  { id: 'gold-helmet', slot: 'helmet' },
  { id: 'gold-chestplate', slot: 'chestplate' },
  { id: 'gold-leggings', slot: 'leggings' },
  { id: 'gold-boots', slot: 'boots' },
  { id: 'diamond-helmet', slot: 'helmet' },
  { id: 'diamond-chestplate', slot: 'chestplate' },
  { id: 'diamond-leggings', slot: 'leggings' },
  { id: 'diamond-boots', slot: 'boots' },
] as const;
type Piece = (typeof classicArmorMatrix)[number];

const playerId = 'armor-target';
const emptyArmor = () => ({ helmet: null, chestplate: null, leggings: null, boots: null });

function createWorld() {
  const world = new GameplayRuntime({
    ...classicOptions(),
    platform: testCorePlatform,
    getWorldTime: () => 8,
    getVoxel: () => Voxel.Air,
    getLoadedCell: () => ({ voxel: Voxel.Air, fluid: 0 }),
    prepareVoxelEdit: () => {
      throw new Error('unexpected voxel edit');
    },
    prepareVoxelEdits: () => {
      throw new Error('unexpected voxel edit batch');
    },
  });
  world.spawnPlayer({ id: playerId, position: [1, 1, 0] });
  world.spawnAutonomous(
    { id: 'classic-zombie', type: 'creature', archetype: 'zombie', position: [0, 1, 0] },
    { archetype: 'zombie' },
  );
  return world;
}

function seedFourSources(world: GameplayRuntime, armorId: string, armorSlot: Piece['slot']) {
  const actor = world.entities.actorStateAccess(playerId);
  // Give and equip armor while its slot is selected, then populate the other
  // drop sources so setup follows the supported inventory action ordering.
  world.giveItem(playerId, { itemId: armorId, count: 1, instance: { durability: 3 } });
  expect(world.equipSelectedArmor(playerId).success).toBe(true);
  actor.inventory.add({ itemId: 'berry', count: 2 });
  actor.replaceInventoryInteraction(actor.inventoryRevision + 1, {
    version: 1,
    revision: actor.inventoryCursor.revision + 1,
    stack: { itemId: 'coal', count: 1 },
    origin: null,
    craftingGrid: [{ itemId: 'plank', count: 1 }, null, null, null],
  });
  // The death transition itself is produced only by registered zombie Combat.
  expect(actor.armor[armorSlot]).toMatchObject({
    itemId: armorId,
    instance: { durability: 3 },
  });
  world.updateEntityWithoutSnapshot(playerId, { health: 1 });
}

function drops(world: GameplayRuntime) {
  return world.queryEntities({ type: 'world-item' }).map(({ stack }) => stack);
}
function dropReferences(world: GameplayRuntime) {
  return world.queryEntities({ type: 'world-item' }).map(({ id, position }) => ({
    id,
    position: [...position],
    lifetime: world.entities.createReference(id)!.lifetime,
  }));
}
function dropIds(world: GameplayRuntime) {
  return world.queryEntities({ type: 'world-item' }).map(({ id }) => id);
}

it.each(classicArmorMatrix)(
  '$id is dropped once after registered lethal Combat, survives death restores, and stays unequipped on respawn',
  (piece) => {
    const source = createWorld();
    seedFourSources(source, piece.id, piece.slot);
    const preDeathReference = source.entities.createReference(playerId)!;

    expect(source.simulation.requestActorCombat('classic-zombie', playerId, 'zombie-claw')).toMatchObject({
      success: true,
    });
    source.advanceRules(0.5);

    expect(source.getCombatState('classic-zombie').lastResult).toMatchObject({ outcome: 'hit', damage: 1 });
    expect(source.getEntity(playerId)).toMatchObject({ type: 'player', health: 0 });
    expect(source.getPlayerState(playerId)).toMatchObject({ health: 0, lifecycle: 'dead' });
    expect(source.entities.actorStateAccess(playerId).armor).toEqual(emptyArmor());
    expect(source.getInventory(playerId).slots.every((slot) => slot === null)).toBe(true);
    expect(source.getInventoryPointerView(playerId).cursor).toMatchObject({
      stack: null,
      craftingGrid: [null, null, null, null],
    });

    const expectedDrops = [
      { itemId: 'berry', count: 2 },
      { itemId: 'coal', count: 1 },
      { itemId: 'plank', count: 1 },
      { itemId: piece.id, count: 1, instance: { durability: 2 } },
    ];
    expect(drops(source)).toHaveLength(4);
    expect(drops(source)).toEqual(expect.arrayContaining(expectedDrops));
    const settledDropIds = dropIds(source);
    const settledDropReferences = dropReferences(source);

    const retry = source.spawnAutonomous(
      { id: 'retry-zombie', type: 'creature', archetype: 'zombie', position: [0, 1, 1] },
      { archetype: 'zombie' },
    );
    expect(retry.id).toBe('retry-zombie');
    expect(source.simulation.requestActorCombat('retry-zombie', playerId, 'zombie-claw').success).toBe(false);
    expect(drops(source)).toEqual(expect.arrayContaining(expectedDrops));
    expect(drops(source)).toHaveLength(4);
    expect(dropIds(source)).toEqual(settledDropIds);

    const deathSnapshot = source.createSnapshot();
    const deathRestore = createWorld();
    deathRestore.restoreSnapshot(deathSnapshot);
    const restoredDeadReference = deathRestore.entities.createReference(playerId)!;
    expect(restoredDeadReference.epoch).toBeGreaterThan(preDeathReference.epoch);
    expect(restoredDeadReference.lifetime).toBe(preDeathReference.lifetime);
    expect(deathRestore.getPlayerState(playerId)).toMatchObject({ health: 0, lifecycle: 'dead' });
    expect(deathRestore.entities.actorStateAccess(playerId).armor).toEqual(emptyArmor());
    expect(drops(deathRestore)).toEqual(drops(source));
    expect(dropIds(deathRestore)).toEqual(settledDropIds);
    expect(dropReferences(deathRestore)).toEqual(settledDropReferences);

    expect(deathRestore.respawnPlayer(playerId)).toEqual({ success: true });
    expect(deathRestore.getPlayerState(playerId)).toMatchObject({ health: 20, lifecycle: 'alive' });
    expect(deathRestore.entities.actorStateAccess(playerId).armor).toEqual(emptyArmor());
    expect(deathRestore.getEntity(playerId)?.position).toEqual(deathRestore.getPlayerState(playerId).spawnPosition);
    expect(drops(deathRestore)).toEqual(drops(source));
    expect(dropIds(deathRestore)).toEqual(settledDropIds);
    expect(dropReferences(deathRestore)).toEqual(settledDropReferences);

    const respawnSnapshot = deathRestore.createSnapshot();
    const respawnRestore = createWorld();
    respawnRestore.restoreSnapshot(respawnSnapshot);
    expect(respawnRestore.getPlayerState(playerId)).toMatchObject({ health: 20, lifecycle: 'alive' });
    expect(respawnRestore.entities.actorStateAccess(playerId).armor).toEqual(emptyArmor());
    expect(drops(respawnRestore)).toEqual(drops(source));
    expect(dropIds(respawnRestore)).toEqual(settledDropIds);
    expect(dropReferences(respawnRestore)).toEqual(settledDropReferences);
    expect(drops(respawnRestore)).toEqual(expect.arrayContaining(expectedDrops));
  },
);
