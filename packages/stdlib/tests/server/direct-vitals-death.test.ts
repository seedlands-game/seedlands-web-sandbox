import { describe, expect, it } from 'vitest';
import { assembleWorldPacks, definePack } from '../../src/server/composition/assembly';
import type { DeathInventoryPolicyDefinitionV1 } from '../../src/server/gameplay/modules/death-inventory-policy-module';
import {
  defineDeathInventoryPolicyModuleV1,
  resolveDeathInventoryPolicyCapabilityV1,
} from '../../src/server/gameplay/modules/death-inventory-policy-module';
import { GameplayRuntime } from '../../src/server/gameplay/gameplay-runtime';
import { createGameplayContent } from '../../src/server/gameplay/gameplay-content';
import { ActorVitalsRuntime } from '../../src/server/gameplay/modules/actor-vitals-runtime';
import { defineContentModule } from '../../src/server/gameplay/modules/content-module';
import { PlayerState } from '../../src/server/gameplay/player-state';
import { prepareEntityMutation } from '../../src/server/gameplay/prepared-entity-mutation';
import { testCorePlatform } from '../support/core-platform';

const emptyArmor = () => ({ helmet: null, chestplate: null, leggings: null, boots: null });
const visor = (durability: number) => ({ itemId: 'sample:visor', count: 1, instance: { durability } });
const suit = (durability: number) => ({ itemId: 'sample:suit', count: 1, instance: { durability } });
const drop = { inventory: 'drop', cursor: 'drop', crafting: 'drop', armor: 'drop', actor: 'retain' } as const;
const retain = { inventory: 'retain', cursor: 'retain', crafting: 'retain', armor: 'retain', actor: 'retain' } as const;
const policy = (kind: 'drop' | 'retain'): DeathInventoryPolicyDefinitionV1 => ({
  version: 1,
  actors: { player: kind === 'drop' ? drop : retain, creature: drop, npc: drop },
});
const sampleItems = [
  { id: 'sample:ore-a', name: 'Ore A', itemType: 'resource' as const, stackLimit: 64, capabilities: [] },
  { id: 'sample:ore-b', name: 'Ore B', itemType: 'resource' as const, stackLimit: 64, capabilities: [] },
  { id: 'sample:ore-c', name: 'Ore C', itemType: 'resource' as const, stackLimit: 64, capabilities: [] },
  {
    id: 'sample:visor',
    name: 'Visor',
    itemType: 'armor' as const,
    stackLimit: 1,
    durability: { max: 40 },
    capabilities: [{ type: 'armor' as const, slot: 'helmet' as const, points: 2 }],
  },
  {
    id: 'sample:suit',
    name: 'Suit',
    itemType: 'armor' as const,
    stackLimit: 1,
    durability: { max: 80 },
    capabilities: [{ type: 'armor' as const, slot: 'chestplate' as const, points: 6 }],
  },
] as const;
const sampleMelee = [
  { id: 'sample:strike', range: 4, steps: [{ damage: 1, windupSeconds: 1, hitSeconds: 0.1, recoverySeconds: 0.1 }] },
] as const;
const sampleProfiles = [
  {
    archetype: 'night-stalker' as const,
    entityType: 'npc' as const,
    maxHealth: 20,
    navigation: { speed: 1, perceptionRange: 8 },
    meleeDefinitionId: 'sample:strike',
  },
] as const;

function setup(deathPolicy: 'drop' | 'retain' | null) {
  const content = defineContentModule({
    moduleId: 'sample:direct-vitals-content',
    items: sampleItems,
    recipes: [],
    meleeDefinitions: [],
  });
  const modules = [
    content,
    ...(deathPolicy === null
      ? []
      : [
          defineDeathInventoryPolicyModuleV1({
            moduleId: 'sample:direct-vitals-death-policy',
            definition: policy(deathPolicy),
          }),
        ]),
  ];
  const pack = definePack({ id: 'sample:direct-vitals', version: '1.0.0', kind: 'playbook', modules });
  const composition = assembleWorldPacks([
    {
      ...pack,
      integrity: {
        algorithm: 'sha256',
        manifestDigest: 'a'.repeat(64),
        entryDigest: 'b'.repeat(64),
        resources: [],
      },
    },
  ]);
  const runtime = new GameplayRuntime({
    composition,
    platform: testCorePlatform,
    getVoxel: () => 0,
    getWorldTime: () => 12,
    prepareVoxelEdit: () => {
      throw new Error('Unexpected voxel edit.');
    },
  });
  runtime.spawnPlayer({ id: 'player', position: [0, 2, 0] });
  const actor = runtime.entities.actorStateAccess('player');
  actor.inventory.add({ itemId: 'sample:ore-a', count: 2 });
  actor.replaceInventoryInteraction(actor.inventoryRevision + 1, {
    version: 1,
    revision: actor.inventoryCursor.revision + 1,
    stack: { itemId: 'sample:ore-b', count: 1 },
    origin: null,
    craftingGrid: [{ itemId: 'sample:ore-c', count: 1 }, null, null, null],
  });
  actor.replaceArmor({ ...emptyArmor(), helmet: visor(1), chestplate: suit(5) });
  runtime.entities.playerStateAccess('player').breakAction = {
    position: [1, 2, 3],
    voxel: 4,
    elapsedSeconds: 0.5,
    requiredSeconds: 1,
  };
  return { runtime, composition };
}

const runtimeState = (runtime: GameplayRuntime) => ({
  entity: runtime.entities.exportComponentSnapshot(),
  simulation: runtime.simulation.snapshot(),
  revision: runtime.gameplayRevision,
});

function directVitals(
  fixture: ReturnType<typeof setup>,
  prepareDeaths: (ids: readonly string[]) => ReturnType<GameplayRuntime['simulation']['prepareDeaths']> = (ids) =>
    fixture.runtime.simulation.prepareDeaths(ids),
) {
  const { runtime, composition } = fixture;
  const player = new PlayerState('player', [0, 2, 0], undefined, runtime.entities);
  return new ActorVitalsRuntime({
    player: (id) => {
      if (id !== player.entityId) throw new RangeError(`Unknown player: ${id}`);
      return player;
    },
    entities: runtime.entities,
    assertCanChange: () => undefined,
    prepareDeaths,
    deathInventory: { kind: 'composed', capability: resolveDeathInventoryPolicyCapabilityV1(composition) },
    touch: () => runtime.recordAuthorityMutation(),
  });
}

function startPlayerAction(runtime: GameplayRuntime) {
  const action = runtime.simulation.actions.start({ actorId: 'player', type: 'idle' }, 0);
  runtime.simulation.actions.markRunning(action.id, []);
}

function legacySetup() {
  const runtime = new GameplayRuntime({
    content: createGameplayContent({
      items: sampleItems,
      recipes: [],
      meleeDefinitions: sampleMelee,
      actorProfiles: sampleProfiles,
      defaultPlayerMeleeDefinitionId: 'sample:strike',
    }),
    platform: testCorePlatform,
    getVoxel: () => 0,
    getWorldTime: () => 12,
    prepareVoxelEdit: () => {
      throw new Error('Unexpected voxel edit.');
    },
  });
  runtime.spawnPlayer({ id: 'player', position: [0, 2, 0] });
  runtime.spawnAutonomous(
    { id: 'target', type: 'npc', archetype: 'night-stalker', position: [0, 2, 1] },
    { archetype: 'night-stalker' },
  );
  const actor = runtime.entities.actorStateAccess('player');
  actor.inventory.add({ itemId: 'sample:ore-a', count: 2 });
  actor.replaceInventoryInteraction(actor.inventoryRevision + 1, {
    version: 1,
    revision: actor.inventoryCursor.revision + 1,
    stack: { itemId: 'sample:ore-b', count: 1 },
    origin: null,
    craftingGrid: [{ itemId: 'sample:ore-c', count: 1 }, null, null, null],
  });
  actor.replaceArmor({ ...emptyArmor(), helmet: visor(1), chestplate: suit(5) });
  return runtime;
}

describe('direct Vitals death inventory policy', () => {
  it('drops all four owned containers with post-hit armor in one revision', () => {
    const { runtime } = setup('drop');
    const beforeRevision = runtime.entities.actorStateAccess('player').inventoryRevision;
    startPlayerAction(runtime);

    expect(runtime.applyDamage('hazard', 'player', 100, 'sample')).toEqual({ success: true });
    const actor = runtime.entities.actorStateAccess('player');
    expect(actor).toMatchObject({ health: 0, lifecycle: 'dead', inventoryRevision: beforeRevision + 1 });
    expect(actor.inventory.snapshot().every((slot) => slot === null)).toBe(true);
    expect(actor.inventoryCursor).toMatchObject({ stack: null, craftingGrid: [null, null, null, null] });
    expect(actor.armor).toEqual(emptyArmor());
    expect(runtime.entities.playerStateAccess('player').breakAction).toBeNull();
    expect(runtime.entities.query({ type: 'world-item' }).map(({ stack }) => stack)).toEqual([
      { itemId: 'sample:ore-a', count: 2 },
      { itemId: 'sample:ore-b', count: 1 },
      { itemId: 'sample:ore-c', count: 1 },
      suit(4),
    ]);
    expect(runtime.simulation.actions.forActor('player')).toBeNull();
    const dropped = runtime.entities.query({ type: 'world-item' }).map(({ stack }) => stack);
    expect(runtime.applyDamage('hazard', 'player', 1, 'sample')).toEqual({
      success: false,
      reason: 'player-dead',
    });
    expect(runtime.entities.query({ type: 'world-item' }).map(({ stack }) => stack)).toEqual(dropped);
  });

  it('retains all containers but commits post-hit armor on death', () => {
    const { runtime } = setup('retain');
    const beforeRevision = runtime.entities.actorStateAccess('player').inventoryRevision;

    expect(runtime.applyDamage('hazard', 'player', 100, 'sample')).toEqual({ success: true });
    const actor = runtime.entities.actorStateAccess('player');
    expect(actor).toMatchObject({ health: 0, lifecycle: 'dead', inventoryRevision: beforeRevision + 1 });
    expect(actor.inventory.slot(0)).toEqual({ itemId: 'sample:ore-a', count: 2 });
    expect(actor.inventoryCursor).toMatchObject({
      stack: { itemId: 'sample:ore-b', count: 1 },
      craftingGrid: [{ itemId: 'sample:ore-c', count: 1 }, null, null, null],
    });
    expect(actor.armor).toEqual({ ...emptyArmor(), chestplate: suit(4) });
    expect(runtime.entities.query({ type: 'world-item' })).toEqual([]);
  });

  it('rejects lethal composed damage without a policy and preserves the full runtime', () => {
    const { runtime } = setup(null);
    const before = runtime.createSnapshot();

    expect(runtime.applyDamage('hazard', 'player', 100, 'sample')).toEqual({
      success: false,
      reason: 'death-inventory-policy-unavailable',
    });
    expect(runtime.createSnapshot()).toEqual(before);
    expect(runtime.entities.query({ type: 'world-item' })).toEqual([]);
  });

  it('keeps nonfatal armor atomic without a policy and leaves creative damage untouched', () => {
    const { runtime } = setup(null);
    const actor = runtime.entities.actorStateAccess('player');
    const beforeRevision = actor.inventoryRevision;

    expect(runtime.applyDamage('hazard', 'player', 10, 'sample')).toEqual({ success: true });
    expect(runtime.entities.get('player')?.health).toBe(13.2);
    expect(actor.armor).toEqual({ ...emptyArmor(), chestplate: suit(4) });
    expect(actor.inventoryRevision).toBe(beforeRevision + 1);
    expect(runtime.healPlayer('player', 1)).toEqual({ success: true });
    expect(runtime.entities.get('player')?.health).toBe(14.2);
    expect(actor.armor).toEqual({ ...emptyArmor(), chestplate: suit(4) });
    expect(actor.inventoryRevision).toBe(beforeRevision + 1);

    const components = runtime.entities.actorComponentSnapshot('player');
    actor.replaceModeComponents({
      mode: { ...components.mode!, value: 'creative', revision: actor.modeRevision + 1 },
      creativeCatalog: components.creativeCatalog!,
      flight: components.flight!,
    });
    const creative = runtimeState(runtime);
    expect(runtime.applyDamage('hazard', 'player', 100, 'sample')).toEqual({ success: true });
    expect(runtimeState(runtime)).toEqual(creative);
  });

  it('rejects a stale death effects frontier before applying health or inventory', () => {
    const fixture = setup('drop');
    const { runtime } = fixture;
    startPlayerAction(runtime);
    let concurrent: ReturnType<typeof runtimeState> | undefined;
    const vitals = directVitals(fixture, (ids) => {
      const effects = runtime.simulation.prepareDeaths(ids);
      runtime.simulation.actions.interruptActor('player', 0, 'concurrent-cancel');
      concurrent = runtimeState(runtime);
      return effects;
    });

    expect(() => vitals.applyDamage('hazard', 'player', 100, 'sample', emptyArmor())).toThrow(/stale/i);
    expect(runtimeState(runtime)).toEqual(concurrent);
    expect(runtime.entities.query({ type: 'world-item' })).toEqual([]);
  });

  it('rejects a stale source replacement before applying death effects', () => {
    const fixture = setup('drop');
    const { runtime } = fixture;
    let concurrent: ReturnType<typeof runtimeState> | undefined;
    const vitals = directVitals(fixture, (ids) => {
      const components = runtime.entities.actorComponentSnapshot('player');
      const mutation = prepareEntityMutation(runtime.entities, {
        actors: [
          {
            reference: runtime.entities.createReference('player')!,
            health: runtime.entities.get('player')!.health!,
            components: {
              ...components,
              needs: { ...components.needs, hunger: 17 },
              equipment: { ...components.equipment, armor: { ...emptyArmor(), chestplate: suit(7) } },
            },
          },
        ],
      });
      mutation.validate();
      mutation.apply();
      concurrent = runtimeState(runtime);
      return runtime.simulation.prepareDeaths(ids);
    });

    expect(() => vitals.applyDamage('hazard', 'player', 100, 'sample', emptyArmor())).toThrow(/stale|changed/i);
    expect(runtimeState(runtime)).toEqual(concurrent);
    expect(runtime.entities.query({ type: 'world-item' })).toEqual([]);
  });

  it('rejects a restored actor lifetime before applying death effects', () => {
    const fixture = setup('drop');
    const { runtime } = fixture;
    let concurrent: ReturnType<typeof runtimeState> | undefined;
    const vitals = directVitals(fixture, (ids) => {
      const effects = runtime.simulation.prepareDeaths(ids);
      runtime.entities.restoreComponentSnapshot(runtime.entities.exportComponentSnapshot());
      concurrent = runtimeState(runtime);
      return effects;
    });

    expect(() => vitals.applyDamage('hazard', 'player', 100, 'sample', emptyArmor())).toThrow(/owner|epoch|stale/i);
    expect(runtimeState(runtime)).toEqual(concurrent);
    expect(runtime.entities.query({ type: 'world-item' })).toEqual([]);
  });

  it('abandons the prepared entity candidate when death effects preparation fails', () => {
    const fixture = setup('drop');
    const { runtime } = fixture;
    const before = runtimeState(runtime);
    const vitals = directVitals(fixture, () => {
      throw new Error('fixture-death-effects-unavailable');
    });

    expect(() => vitals.applyDamage('hazard', 'player', 100, 'sample', emptyArmor())).toThrow(
      'fixture-death-effects-unavailable',
    );
    expect(runtimeState(runtime)).toEqual(before);
    expect(runtime.entities.query({ type: 'world-item' })).toEqual([]);
  });

  it('rejects composed drop allocation exhaustion without applying death effects', () => {
    const { runtime } = setup('drop');
    const exhausted = runtime.createSnapshot();
    exhausted.entityStore.sequence = Number.MAX_SAFE_INTEGER;
    runtime.restoreSnapshot(exhausted);
    const before = runtimeState(runtime);

    expect(() => runtime.applyDamage('hazard', 'player', 100, 'sample')).toThrow(/sequence.*exhausted/i);
    expect(runtimeState(runtime)).toEqual(before);
    expect(runtime.entities.query({ type: 'world-item' })).toEqual([]);
  });

  it('uses the same composed policy for direct legacy needs advancement', () => {
    const retained = setup('retain');
    const retainedPlayer = retained.runtime.entities.playerStateAccess('player');
    retained.runtime.updateEntityWithoutSnapshot('player', { health: 1 });
    retainedPlayer.hunger = 0;
    retainedPlayer.starvationAccumulator = 14;
    const retainedVitals = directVitals(retained);

    retainedVitals.advanceNeeds('player', 1);
    expect(retained.runtime.entities.get('player')?.health).toBe(0);
    expect(retainedPlayer).toMatchObject({ lifecycle: 'dead', hunger: 0, starvationAccumulator: 0 });
    expect(retainedPlayer.inventory.slot(0)).toEqual({ itemId: 'sample:ore-a', count: 2 });
    expect(retained.runtime.entities.query({ type: 'world-item' })).toEqual([]);

    const missing = setup(null);
    const missingPlayer = missing.runtime.entities.playerStateAccess('player');
    missing.runtime.updateEntityWithoutSnapshot('player', { health: 1 });
    missingPlayer.hunger = 0;
    missingPlayer.starvationAccumulator = 14;
    const before = runtimeState(missing.runtime);

    expect(() => directVitals(missing).advanceNeeds('player', 1)).toThrow('death-inventory-policy-unavailable');
    expect(runtimeState(missing.runtime)).toEqual(before);
    expect(missing.runtime.entities.query({ type: 'world-item' })).toEqual([]);
  });

  it('preserves explicit uncomposed legacy death while preparing combat and armor atomically', () => {
    const runtime = legacySetup();
    const beforeRevision = runtime.entities.actorStateAccess('player').inventoryRevision;
    expect(runtime.attackEntity('player', 'target')).toMatchObject({ success: true });

    expect(runtime.applyDamage('hazard', 'player', 100, 'sample')).toEqual({ success: true });
    const actor = runtime.entities.actorStateAccess('player');
    expect(actor).toMatchObject({ health: 0, lifecycle: 'dead', inventoryRevision: beforeRevision + 1 });
    expect(actor.armor).toEqual({ ...emptyArmor(), chestplate: suit(4) });
    expect(runtime.entities.query({ type: 'world-item' }).map(({ stack }) => stack)).toEqual([
      { itemId: 'sample:ore-a', count: 2 },
      { itemId: 'sample:ore-b', count: 1 },
      { itemId: 'sample:ore-c', count: 1 },
    ]);
    expect(runtime.simulation.combat.snapshotFor('player').active).toBeNull();
    expect(runtime.simulation.actions.forActor('player')).toBeNull();
  });
});
