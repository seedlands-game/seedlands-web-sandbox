import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assembleOverworldPacks,
  createGameplayActorAuthority,
  createGameplaySystemAuthority,
} from '@seedlands/stdlib/host';
import type { CompositionCheckpointIdentity } from '@seedlands/stdlib/mod-api';
import { pack } from '../../../../../../../playbooks/classic/src/pack';
import { GameplayRuntime } from '../../../../fixtures/classic/content';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';

const emptyArmor = () => ({ helmet: null, chestplate: null, leggings: null, boots: null });
const preDeathV4Identity = () => {
  const capture = JSON.parse(
    readFileSync(
      new URL(
        '../../../../../../../changes/2026-09-23-classic-functional-completion/evidence/v2-death-mixed-series-01/pre-death-v4-identity.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as { identity: { value: CompositionCheckpointIdentity } };
  return capture.identity.value;
};

function createWorld() {
  const composition = assembleOverworldPacks([
    {
      ...pack,
      integrity: {
        algorithm: 'sha256',
        manifestDigest: 'a'.repeat(64),
        entryDigest: 'b'.repeat(64),
        resources: pack.manifest.resources!.map((path) => ({ path, digest: 'c'.repeat(64) })),
      },
    },
  ]);
  const runtime = new GameplayRuntime({
    composition,
    moduleActorAuthority: createGameplayActorAuthority(composition.resources, { playerAlias: 'test-player' }),
    moduleSystemAuthority: createGameplaySystemAuthority(composition),
    platform: testCorePlatform,
    getWorldTime: () => 12,
    getVoxel: () => 0,
    getLoadedCell: () => ({ voxel: 0, fluid: 0 }),
    prepareVoxelEdit: () => {
      throw new Error('unexpected');
    },
    prepareVoxelEdits: () => {
      throw new Error('unexpected');
    },
  });
  runtime.spawnPlayer({ id: 'player', position: [0, 1, 0] });
  return runtime;
}

function seedFourContainers(world: GameplayRuntime, id: string) {
  const actor = world.entities.actorStateAccess(id);
  actor.inventory.add({ itemId: 'berry', count: 2 });
  actor.replaceInventoryInteraction(actor.inventoryRevision + 1, {
    version: 1,
    revision: 1,
    stack: { itemId: 'coal', count: 1 },
    origin: null,
    craftingGrid: [{ itemId: 'plank', count: 1 }, null, null, null],
  });
  actor.replaceArmor({
    ...emptyArmor(),
    helmet: { itemId: 'iron-helmet', count: 1, instance: { durability: 2 } },
  });
}

describe('Classic registered Combat death policy', () => {
  it('restores the exact pre-death V4 envelope and preserves one settled death across another restore', () => {
    const source = createWorld();
    source.giveItem('player', { itemId: 'iron-helmet', count: 1, instance: { durability: 2 } });
    expect(source.equipSelectedArmor('player')).toMatchObject({ success: true });
    source.giveItem('player', { itemId: 'berry', count: 2 });
    const sourceActor = source.entities.actorStateAccess('player');
    sourceActor.replaceInventoryInteraction(sourceActor.inventoryRevision + 1, {
      version: 1,
      revision: 1,
      stack: { itemId: 'coal', count: 1 },
      origin: null,
      craftingGrid: [{ itemId: 'plank', count: 1 }, null, null, null],
    });
    const saved = source.createSnapshot();
    saved.composition = preDeathV4Identity();
    const sourceReference = source.entities.createReference('player')!;
    const target = createWorld();

    expect(target.restoreSnapshot(saved)).toEqual({ version: 4, worldTime: 12 });
    const restoredReference = target.entities.createReference('player')!;
    expect(restoredReference.epoch).toBeGreaterThan(sourceReference.epoch);
    expect(restoredReference.lifetime).toBe(sourceReference.lifetime);
    expect(target.applyDamage('fixture', 'player', 100, 'fixture')).toEqual({ success: true });
    expect(target.getEntity('player')).toMatchObject({ type: 'player', health: 0 });
    expect(target.getInventory('player').slots.every((slot) => slot === null)).toBe(true);
    expect(target.getInventoryPointerView('player').cursor).toMatchObject({
      stack: null,
      craftingGrid: [null, null, null, null],
    });
    expect(target.entities.actorStateAccess('player').armor).toEqual(emptyArmor());
    const droppedEntities = target.queryEntities({ type: 'world-item' });
    expect(droppedEntities).toHaveLength(4);
    const dropped = droppedEntities.map(({ stack }) => stack);
    expect(dropped).toEqual(
      expect.arrayContaining([
        { itemId: 'berry', count: 2 },
        { itemId: 'coal', count: 1 },
        { itemId: 'plank', count: 1 },
        { itemId: 'iron-helmet', count: 1, instance: { durability: 1 } },
      ]),
    );

    const reopened = createWorld();
    reopened.restoreSnapshot(target.createSnapshot());
    expect(reopened.getEntity('player')).toMatchObject({ type: 'player', health: 0 });
    expect(reopened.getInventory('player').slots.every((slot) => slot === null)).toBe(true);
    expect(reopened.getInventoryPointerView('player').cursor.craftingGrid).toEqual([null, null, null, null]);
    expect(reopened.queryEntities({ type: 'world-item' }).map(({ stack }) => stack)).toEqual(dropped);
  });

  it('drops creature containers plus intrinsic loot once and despawns the actor', () => {
    const world = createWorld();
    world.spawnAutonomous(
      { id: 'zombie', type: 'creature', archetype: 'zombie', position: [0, 1, 1], health: 3.68 },
      { archetype: 'zombie' },
    );
    seedFourContainers(world, 'zombie');

    expect(world.attackEntity('player', 'zombie')).toMatchObject({ success: true, damage: 3.68 });
    expect(world.getEntity('zombie')).toBeNull();
    expect(world.simulation.actorIds()).not.toContain('zombie');
    const dropped = world.queryEntities({ type: 'world-item' }).map(({ stack }) => stack);
    expect(dropped).toHaveLength(5);
    expect(dropped).toEqual(
      expect.arrayContaining([
        { itemId: 'berry', count: 2 },
        { itemId: 'coal', count: 1 },
        { itemId: 'plank', count: 1 },
        { itemId: 'iron-helmet', count: 1, instance: { durability: 1 } },
        { itemId: 'rotten-flesh', count: 1 },
      ]),
    );
    expect(world.attackEntity('player', 'zombie').success).toBe(false);
    expect(world.queryEntities({ type: 'world-item' }).map(({ stack }) => stack)).toEqual(dropped);
  });

  it('uses the same four-container policy for an unprofiled NPC and despawns it', () => {
    const world = createWorld();
    world.spawn({ id: 'npc', type: 'npc', position: [0, 1, 1], health: 3.68, maxHealth: 20 });
    seedFourContainers(world, 'npc');

    expect(world.attackEntity('player', 'npc')).toMatchObject({ success: true, damage: 3.68 });
    expect(world.getEntity('npc')).toBeNull();
    const dropped = world.queryEntities({ type: 'world-item' });
    expect(dropped).toHaveLength(4);
    expect(dropped.map(({ stack }) => stack)).toEqual(
      expect.arrayContaining([
        { itemId: 'berry', count: 2 },
        { itemId: 'coal', count: 1 },
        { itemId: 'plank', count: 1 },
        { itemId: 'iron-helmet', count: 1, instance: { durability: 1 } },
      ]),
    );
  });
});
