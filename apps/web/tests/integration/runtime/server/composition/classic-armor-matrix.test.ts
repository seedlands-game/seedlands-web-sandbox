/**
 * Deterministic full-Classic coverage for every armor piece through Authority and registered Combat.
 */
import { expect, it } from 'vitest';
import { AuthorityRuntime } from '../../../../../../../packages/stdlib/src/server/authority/authority-runtime';
import type { AuthorityAction } from '../../../../../../../packages/stdlib/src/server/protocol/authority-worker-protocol';
import { MemoryGamePersistence } from '../../../../../../../packages/stdlib/src/server/persistence/memory-game-persistence';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { classicWorldgenProvider } from '@seedlands/playbook-classic/worldgen';
import { Voxel } from '@seedlands/stdlib/world/voxel';
import { classicContent, classicOptions, GameplayRuntime } from '../../../../fixtures/classic/content';

// Literal compatibility oracle frozen in the recovery spec: preserve current
// Classic balance; derive no expected values from the production registry at runtime.
const classicArmorMatrix = [
  { id: 'leather-helmet', slot: 'helmet', points: 1, maxDurability: 55, damageFromZombieClaw: 2.88 },
  { id: 'leather-chestplate', slot: 'chestplate', points: 3, maxDurability: 55, damageFromZombieClaw: 2.64 },
  { id: 'leather-leggings', slot: 'leggings', points: 2, maxDurability: 55, damageFromZombieClaw: 2.76 },
  { id: 'leather-boots', slot: 'boots', points: 1, maxDurability: 55, damageFromZombieClaw: 2.88 },
  { id: 'iron-helmet', slot: 'helmet', points: 2, maxDurability: 165, damageFromZombieClaw: 2.76 },
  { id: 'iron-chestplate', slot: 'chestplate', points: 6, maxDurability: 165, damageFromZombieClaw: 2.28 },
  { id: 'iron-leggings', slot: 'leggings', points: 5, maxDurability: 165, damageFromZombieClaw: 2.4 },
  { id: 'iron-boots', slot: 'boots', points: 2, maxDurability: 165, damageFromZombieClaw: 2.76 },
  { id: 'gold-helmet', slot: 'helmet', points: 2, maxDurability: 77, damageFromZombieClaw: 2.76 },
  { id: 'gold-chestplate', slot: 'chestplate', points: 5, maxDurability: 77, damageFromZombieClaw: 2.4 },
  { id: 'gold-leggings', slot: 'leggings', points: 3, maxDurability: 77, damageFromZombieClaw: 2.64 },
  { id: 'gold-boots', slot: 'boots', points: 1, maxDurability: 77, damageFromZombieClaw: 2.88 },
  { id: 'diamond-helmet', slot: 'helmet', points: 3, maxDurability: 363, damageFromZombieClaw: 2.64 },
  { id: 'diamond-chestplate', slot: 'chestplate', points: 8, maxDurability: 363, damageFromZombieClaw: 2.04 },
  { id: 'diamond-leggings', slot: 'leggings', points: 6, maxDurability: 363, damageFromZombieClaw: 2.28 },
  { id: 'diamond-boots', slot: 'boots', points: 3, maxDurability: 363, damageFromZombieClaw: 2.64 },
] as const;

type Piece = (typeof classicArmorMatrix)[number];
type Classic = ReturnType<typeof classicOptions>;

it('固定16个Classic护甲oracle恰好覆盖内容注册的护甲ID', () => {
  const registeredArmorIds = classicContent.items
    .list()
    .filter((definition) => definition.itemType === 'armor')
    .map((definition) => definition.id)
    .sort();
  expect(classicArmorMatrix).toHaveLength(16);
  expect(new Set(classicArmorMatrix.map(({ id }) => id)).size).toBe(16);
  expect(classicArmorMatrix.map(({ id }) => id).sort()).toEqual(registeredArmorIds);
});
const options: Classic = classicOptions();
const createAuthority = (persistence: MemoryGamePersistence) =>
  AuthorityRuntime.create({
    ...options,
    worldgenProvider: classicWorldgenProvider,
    platform: testCorePlatform,
    persistence,
    epoch: 'classic-armor-matrix-authority',
    seedText: 'classic-armor-matrix',
    initialWorldTime: 8,
    startTimeMs: 0,
    initialPlayerBodyPosition: [0.5, 60, 0.5],
  });
const freshPersistence = () => new MemoryGamePersistence({ clone: testCorePlatform.clone });
const inventoryPointerAction = (
  runtime: Awaited<ReturnType<typeof createAuthority>>,
  command: Extract<AuthorityAction, { type: 'inventory-pointer' }>['command'],
): Promise<unknown> => {
  const view = runtime.server.getInventoryPointerView(runtime.playerId);
  return runtime.performAction({
    type: 'inventory-pointer',
    actor: view.actor,
    expectedInventoryRevision: view.revision,
    command,
  });
};

it.each(classicArmorMatrix)(
  '$id accepts only its matching Authority equipment slot and persists',
  async (piece: Piece) => {
    const persistence = freshPersistence();
    const runtime = await createAuthority(persistence);
    const definition = runtime.server.gameplayContent.items.require(piece.id);
    expect(definition.itemType).toBe('armor');
    expect(definition.durability?.max).toBe(piece.maxDurability);
    expect(runtime.server.gameplayContent.items.capability(piece.id, 'armor')).toMatchObject({
      slot: piece.slot,
      points: piece.points,
    });
    // Classic runtime content stores inventory stacks under storageId (the short ID).
    runtime.server.giveItem(runtime.playerId, {
      itemId: piece.id,
      count: 1,
      instance: { durability: 3 },
    });
    const inventory = runtime.server.getInventoryPointerView(runtime.playerId);
    const sourceSlot = inventory.slots.findIndex((stack) => stack?.itemId === piece.id);
    expect(sourceSlot).toBeGreaterThanOrEqual(0);

    expect(
      await inventoryPointerAction(runtime, {
        kind: 'click',
        slot: { kind: 'inventory', slot: sourceSlot },
        button: 0,
      }),
    ).toMatchObject({ result: { success: true } });
    const beforeWrongSlot = runtime.server.getInventoryPointerView(runtime.playerId);
    const wrongSlot = piece.slot === 'helmet' ? 'chestplate' : 'helmet';
    expect(
      await inventoryPointerAction(runtime, {
        kind: 'click',
        slot: { kind: 'equipment', slot: wrongSlot },
        button: 0,
      }),
    ).toMatchObject({ result: { success: false, reason: 'invalid-pointer-slot' } });
    expect(runtime.server.getInventoryPointerView(runtime.playerId)).toEqual(beforeWrongSlot);

    expect(
      await inventoryPointerAction(runtime, {
        kind: 'click',
        slot: { kind: 'equipment', slot: piece.slot },
        button: 0,
      }),
    ).toMatchObject({ result: { success: true } });
    expect(runtime.server.getInventoryPointerView(runtime.playerId).armor[piece.slot]).toEqual({
      itemId: piece.id,
      count: 1,
      instance: { durability: 3 },
    });

    const saved = await runtime.save();
    expect(saved.gameplaySaved).toBe(true);
    const restored = await createAuthority(persistence);
    expect(restored.server.getInventoryPointerView(restored.playerId).armor[piece.slot]).toEqual({
      itemId: piece.id,
      count: 1,
      instance: { durability: 3 },
    });
  },
);

const createFullClassicCombatWorld = () => {
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
  world.spawnPlayer({ id: 'armor-target', position: [1, 1, 0] });
  world.spawnAutonomous(
    { id: 'classic-zombie', type: 'creature', archetype: 'zombie', position: [0, 1, 0] },
    { archetype: 'zombie' },
  );
  return world;
};

it.each(classicArmorMatrix)('$id reduces a registered zombie hit, wears, snapshots, and restores', (piece: Piece) => {
  const world = createFullClassicCombatWorld();
  // Full pack definitions are namespaced, but gameplay stacks use each definition's storageId.
  world.giveItem('armor-target', {
    itemId: piece.id,
    count: 1,
    instance: { durability: 3 },
  });
  expect(world.equipSelectedArmor('armor-target')).toMatchObject({ success: true, slot: piece.slot });
  const healthBefore = world.getEntity('armor-target')!.health!;

  // This is the same registered NPC producer used by registered-combat-armor.test.ts.
  // Do not replace with GameplayRuntime.applyDamage/GameServer.applyDamage.
  expect(world.simulation.requestActorCombat('classic-zombie', 'armor-target', 'zombie-claw')).toMatchObject({
    success: true,
  });
  // Classic zombie-claw has a 0.3s windup and 0.1s hit stage; advance its
  // registered authority schedule to commit that one resolved hit.
  world.advanceRules(0.5);
  expect(healthBefore - world.getEntity('armor-target')!.health!).toBeCloseTo(piece.damageFromZombieClaw, 6);
  expect(world.entities.actorStateAccess('armor-target').armor[piece.slot]).toMatchObject({
    itemId: piece.id,
    instance: { durability: 2 },
  });

  const saved = world.createSnapshot();
  const restored = createFullClassicCombatWorld();
  restored.restoreSnapshot(saved);
  expect(restored.entities.actorStateAccess('armor-target').armor[piece.slot]).toMatchObject({
    itemId: piece.id,
    instance: { durability: 2 },
  });
  expect(restored.getEntity('armor-target')!.health).toBeCloseTo(20 - piece.damageFromZombieClaw, 6);
});
