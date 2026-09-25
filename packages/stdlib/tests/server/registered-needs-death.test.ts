import { describe, expect, it } from 'vitest';
import { assembleWorldPacks, definePack } from '../../src/server/composition/assembly';
import type { ModModule } from '../../src/server/composition/contracts';
import { createGameplayActorAuthority } from '../../src/server/composition/gameplay-actor-authority';
import { createGameplaySystemAuthority } from '../../src/server/composition/gameplay-system-authority';
import type { DeathInventoryPolicyDefinitionV1 } from '../../src/server/gameplay/modules/death-inventory-policy-module';
import {
  defineDeathInventoryPolicyModuleV1,
  resolveDeathInventoryPolicyCapabilityV1,
} from '../../src/server/gameplay/modules/death-inventory-policy-module';
import { GameplayRuntime } from '../../src/server/gameplay/gameplay-runtime';
import { prepareEntityMutation } from '../../src/server/gameplay/prepared-entity-mutation';
import { defineCombatModule } from '../../src/server/gameplay/modules/combat-module';
import { defineCombatRulesModule } from '../../src/server/gameplay/modules/combat-rules-module';
import { defineContentModule } from '../../src/server/gameplay/modules/content-module';
import { defineNeedsModule, needsAddress } from '../../src/server/gameplay/modules/needs-module';
import {
  advanceNeedsEntry,
  NEEDS_PARTITIONS,
  validateNeedsPartition,
  type NeedsProfiles,
} from '../../src/server/gameplay/modules/needs-model';
import { defineNeedsRulesModule } from '../../src/server/gameplay/modules/needs-rules-module';
import { createNeedsStatePort } from '../../src/server/gameplay/modules/needs-state-port';
import { defineRulesetModule } from '../../src/server/gameplay/modules/ruleset-module';
import { testCorePlatform } from '../support/core-platform';

const emptyArmor = () => ({ helmet: null, chestplate: null, leggings: null, boots: null });
const visor = (durability = 9) => ({ itemId: 'sample:visor', count: 1, instance: { durability } });
const retain = { inventory: 'retain', cursor: 'retain', crafting: 'retain', armor: 'retain', actor: 'retain' } as const;
const drop = { inventory: 'drop', cursor: 'drop', crafting: 'drop', armor: 'drop', actor: 'retain' } as const;
const despawn = { ...drop, actor: 'despawn' } as const;
const profiles: NeedsProfiles = {
  satiety: {
    enabledModes: ['survival'],
    hungerEverySeconds: 1,
    hungerDelta: -1,
    starvation: { threshold: 0, everySeconds: 1, damage: 1 },
  },
  deficit: { enabledModes: ['survival'], hungerEverySeconds: 1, hungerDelta: 1 },
};
const definition = (kind: 'drop' | 'retain' | 'despawn'): DeathInventoryPolicyDefinitionV1 => ({
  version: 1,
  actors: {
    player: kind === 'drop' ? drop : kind === 'retain' ? retain : despawn,
    creature: despawn,
    npc: despawn,
  },
});
const compositions = new WeakMap<GameplayRuntime, ReturnType<typeof assembleWorldPacks>>();

function setup(policy: 'drop' | 'retain' | 'despawn' | null, extraModules: readonly ModModule[] = []) {
  const content = defineContentModule({
    moduleId: 'sample:registered-needs-content',
    items: [
      { id: 'sample:ore-a', name: 'Ore A', itemType: 'resource', stackLimit: 64, capabilities: [] },
      { id: 'sample:ore-b', name: 'Ore B', itemType: 'resource', stackLimit: 64, capabilities: [] },
      { id: 'sample:ore-c', name: 'Ore C', itemType: 'resource', stackLimit: 64, capabilities: [] },
      { id: 'sample:filler', name: 'Filler', itemType: 'resource', stackLimit: 1, capabilities: [] },
      {
        id: 'sample:visor',
        name: 'Visor',
        itemType: 'armor',
        stackLimit: 1,
        durability: { max: 40 },
        capabilities: [{ type: 'armor', slot: 'helmet', points: 2 }],
      },
    ],
    recipes: [],
    meleeDefinitions: [
      {
        id: 'sample:strike',
        range: 4,
        steps: [{ damage: 1, windupSeconds: 2, hitSeconds: 0.1, recoverySeconds: 0.1 }],
      },
    ],
    actorProfiles: [
      {
        archetype: 'night-stalker',
        entityType: 'npc',
        maxHealth: 20,
        navigation: { speed: 1, perceptionRange: 8 },
        meleeDefinitionId: 'sample:strike',
      },
    ],
  });
  const modules = [
    content,
    defineRulesetModule({ id: 'sample:registered-needs-rules', version: '1.0.0' }),
    defineNeedsModule(),
    defineCombatModule(),
    defineCombatRulesModule({
      moduleId: 'sample:registered-needs-combat-rules',
      profile: { damageMultiplier: 1, immuneTargetModes: ['creative'] },
    }),
    defineNeedsRulesModule({
      moduleId: 'sample:registered-needs-policy',
      profiles,
    }),
    ...(policy === null
      ? []
      : [
          defineDeathInventoryPolicyModuleV1({
            moduleId: 'sample:registered-needs-death-policy',
            definition: definition(policy),
          }),
        ]),
    ...extraModules,
  ];
  const pack = definePack({ id: 'sample:registered-needs', version: '1.0.0', kind: 'playbook', modules });
  const composition = assembleWorldPacks(
    [
      {
        ...pack,
        integrity: {
          algorithm: 'sha256',
          manifestDigest: 'a'.repeat(64),
          entryDigest: 'b'.repeat(64),
          resources: [],
        },
      },
    ],
    { approvedPermissions: { [pack.manifest.id]: modules.flatMap((module) => module.descriptor.permissions ?? []) } },
  );
  const world = new GameplayRuntime({
    composition,
    moduleSystemAuthority: createGameplaySystemAuthority(composition),
    moduleActorAuthority: createGameplayActorAuthority(composition.resources, { playerAlias: 'human' }),
    platform: testCorePlatform,
    getWorldTime: () => 0,
    getVoxel: () => 0,
    prepareVoxelEdit: () => {
      throw new Error('Unexpected voxel edit.');
    },
  });
  world.spawnPlayer({ id: 'z-dying', position: [0, 2, 0] });
  world.spawnPlayer({ id: 'a-survivor', position: [2, 2, 0] });
  const dying = world.entities.actorStateAccess('z-dying');
  dying.inventory.add({ itemId: 'sample:ore-a', count: 2 });
  dying.replaceInventoryInteraction(dying.inventoryRevision + 1, {
    version: 1,
    revision: dying.inventoryCursor.revision + 1,
    stack: { itemId: 'sample:ore-b', count: 1 },
    origin: null,
    craftingGrid: [{ itemId: 'sample:ore-c', count: 1 }, null, null, null],
  });
  dying.replaceArmor({ ...emptyArmor(), helmet: visor() });
  world.entities.playerStateAccess('z-dying').breakAction = {
    position: [1, 2, 3],
    voxel: 4,
    elapsedSeconds: 0.5,
    requiredSeconds: 1,
  };
  const snapshot = world.createSnapshot();
  const dyingActor = snapshot.entityStore.actors.find(({ entityId }) => entityId === 'z-dying')!;
  dyingActor.needs.hunger = 0;
  dyingActor.needs.starvationAccumulator = 0;
  snapshot.entityStore.entities.find(({ id }) => id === 'z-dying')!.health = 1;
  world.restoreSnapshot(snapshot);
  compositions.set(world, composition);
  return world;
}

const worldState = (world: GameplayRuntime) => ({
  entities: structuredClone(world.entities.exportComponentSnapshot()),
  simulation: structuredClone(world.simulation.snapshot()),
  revision: world.gameplayRevision,
});

function armStarvation(world: GameplayRuntime, ids: readonly string[]): void {
  const snapshot = world.createSnapshot();
  for (const id of ids) {
    const actor = snapshot.entityStore.actors.find(({ entityId }) => entityId === id)!;
    actor.needs.hunger = 0;
    actor.needs.starvationAccumulator = 0;
    snapshot.entityStore.entities.find((entry) => entry.id === id)!.health = 1;
  }
  world.restoreSnapshot(snapshot);
}

function disarmStarvation(world: GameplayRuntime): void {
  const snapshot = world.createSnapshot();
  const actor = snapshot.entityStore.actors.find(({ entityId }) => entityId === 'z-dying')!;
  actor.needs.hunger = 20;
  actor.needs.starvationAccumulator = 0;
  snapshot.entityStore.entities.find(({ id }) => id === 'z-dying')!.health = 20;
  world.restoreSnapshot(snapshot);
}

function prepareNeedsCommit(
  world: GameplayRuntime,
  prepareDeaths: (ids: readonly string[]) => ReturnType<GameplayRuntime['simulation']['prepareDeaths']>,
) {
  const port = createNeedsStatePort({
    entities: world.entities,
    actorIds: () => world.entities.exportComponentSnapshot().actors.map(({ entityId }) => entityId),
    revision: () => world.gameplayRevision,
    assertCanChange: () => undefined,
    changed: () => world.recordAuthorityMutation(),
    prepareDeaths,
    deathInventory: {
      kind: 'composed',
      capability: resolveDeathInventoryPolicyCapabilityV1(compositions.get(world)!),
    },
  });
  const projected = Array.from({ length: NEEDS_PARTITIONS }, (_, partition) => {
    const address = needsAddress(partition);
    const state = port.read(address);
    return { address, ...state };
  });
  return () =>
    port.commit(
      projected.map(({ address, revision }) => ({ address, revision })),
      projected.map(({ address, value }) => {
        const before = validateNeedsPartition(value);
        return {
          address,
          value: {
            ...before,
            entries: before.entries.map((entry) => advanceNeedsEntry(entry, profiles[entry.needs.hungerMeaning], 1)),
          },
        };
      }),
    );
}

describe('registered Needs death inventory policy', () => {
  it('commits one survivor and one player death with all four containers in one schedule transaction', () => {
    const world = setup('drop');
    const dyingRevision = world.entities.actorStateAccess('z-dying').inventoryRevision;
    const survivorRevision = world.entities.actorStateAccess('a-survivor').inventoryRevision;

    world.advanceRules(1);

    expect(world.getPlayerState('a-survivor').hunger).toBe(19);
    expect(world.entities.actorStateAccess('a-survivor').inventoryRevision).toBe(survivorRevision);
    const dying = world.entities.actorStateAccess('z-dying');
    expect(dying).toMatchObject({ health: 0, lifecycle: 'dead', inventoryRevision: dyingRevision + 1 });
    expect(dying.inventory.snapshot().every((slot) => slot === null)).toBe(true);
    expect(dying.inventoryCursor).toMatchObject({ stack: null, craftingGrid: [null, null, null, null] });
    expect(dying.armor).toEqual(emptyArmor());
    expect(world.entities.playerStateAccess('z-dying').breakAction).toBeNull();
    expect(world.entities.query({ type: 'world-item' }).map(({ stack }) => stack)).toEqual([
      { itemId: 'sample:ore-a', count: 2 },
      { itemId: 'sample:ore-b', count: 1 },
      { itemId: 'sample:ore-c', count: 1 },
      visor(),
    ]);
    const dropped = world.entities.query({ type: 'world-item' }).map(({ stack }) => stack);
    world.advanceRules(1);
    expect(world.entities.query({ type: 'world-item' }).map(({ stack }) => stack)).toEqual(dropped);
  });

  it('retains all containers while committing the same registered starvation death', () => {
    const world = setup('retain');
    const beforeRevision = world.entities.actorStateAccess('z-dying').inventoryRevision;

    world.advanceRules(1);

    const dying = world.entities.actorStateAccess('z-dying');
    expect(dying).toMatchObject({ health: 0, lifecycle: 'dead', inventoryRevision: beforeRevision });
    expect(dying.inventory.slot(0)).toEqual({ itemId: 'sample:ore-a', count: 2 });
    expect(dying.inventoryCursor).toMatchObject({
      stack: { itemId: 'sample:ore-b', count: 1 },
      craftingGrid: [{ itemId: 'sample:ore-c', count: 1 }, null, null, null],
    });
    expect(dying.armor).toEqual({ ...emptyArmor(), helmet: visor() });
    expect(world.entities.query({ type: 'world-item' })).toEqual([]);
  });

  it('rejects a missing composed policy before any survivor or death write', () => {
    const world = setup(null);
    const before = worldState(world);

    expect(() => world.advanceRules(1)).toThrow(/death-inventory-policy-unavailable/);
    expect(worldState(world)).toEqual(before);
    expect(world.entities.query({ type: 'world-item' })).toEqual([]);
  });

  it('rejects player despawn policy without orphaning GameplayRuntime membership', () => {
    const world = setup('despawn');
    const before = worldState(world);

    expect(() => world.advanceRules(1)).toThrow(/needs-player-despawn-policy-unsupported/);
    expect(worldState(world)).toEqual(before);
    expect(world.getPlayerState('z-dying')).toMatchObject({ lifecycle: 'alive', health: 1 });
  });

  it.each([null, 'despawn'] as const)('keeps a nonfatal batch available with %s policy', (policy) => {
    const world = setup(policy);
    disarmStarvation(world);

    expect(() => world.advanceRules(1)).not.toThrow();
    expect(world.getPlayerState('a-survivor')).toMatchObject({ lifecycle: 'alive', health: 20, hunger: 19 });
    expect(world.getPlayerState('z-dying')).toMatchObject({ lifecycle: 'alive', health: 20, hunger: 19 });
    expect(world.entities.query({ type: 'world-item' })).toEqual([]);
  });

  it('settles a real incoming combat action through the same death effects participant', () => {
    const world = setup('drop');
    world.spawnAutonomous(
      { id: 'stalker', type: 'npc', archetype: 'night-stalker', position: [1, 2, 0] },
      { archetype: 'night-stalker' },
    );
    expect(world.simulation.requestActorCombat('stalker', 'z-dying', 'sample:strike')).toMatchObject({ success: true });

    world.advanceRules(1);

    expect(world.getPlayerState('z-dying')).toMatchObject({ health: 0, lifecycle: 'dead' });
    expect(world.simulation.combat.snapshotFor('stalker').active).toBeNull();
    expect(world.simulation.actions.forActor('stalker')).toBeNull();
  });

  it('rejects a rule that changes non-player health and leaves the whole batch untouched', () => {
    const corrupt: ModModule = {
      descriptor: {
        id: 'sample:corrupt-npc-health',
        version: '1.0.0',
        permissions: [{ resource: 'seedlands.needs', operations: ['read', 'write', 'execute'] }],
      },
      register(api) {
        api.registerRule({
          id: 'sample:corrupt-npc-health/after',
          operationId: 'seedlands:advance-needs',
          stage: 'after',
          apply(_context, _input, state) {
            for (let partition = 0; partition < NEEDS_PARTITIONS; partition++) {
              const address = needsAddress(partition);
              const current = validateNeedsPartition(state.read(address));
              if (!current.entries.some(({ kind }) => kind !== 'player')) continue;
              state.write(address, {
                ...current,
                entries: current.entries.map((entry) =>
                  entry.kind === 'player' ? entry : { ...entry, health: entry.health - 1 },
                ),
              });
            }
          },
        });
      },
    };
    const world = setup('drop', [corrupt]);
    world.spawnAutonomous(
      { id: 'npc', type: 'npc', archetype: 'night-stalker', position: [4, 2, 0] },
      { archetype: 'night-stalker' },
    );
    const before = worldState(world);

    expect(() => world.advanceRules(1)).toThrow(/needs-readonly-fields-changed/);
    expect(worldState(world)).toEqual(before);
    expect(world.entities.query({ type: 'world-item' })).toEqual([]);
  });

  it('rejects survivor source drift before applying its mixed death candidate', () => {
    const world = setup('drop');
    let concurrent: ReturnType<typeof worldState> | undefined;
    const commit = prepareNeedsCommit(world, (ids) => {
      const survivor = world.entities.actorComponentSnapshot('a-survivor');
      const mutation = prepareEntityMutation(world.entities, {
        actors: [
          {
            reference: world.entities.createReference('a-survivor')!,
            health: world.entities.get('a-survivor')!.health!,
            components: { ...survivor, needs: { ...survivor.needs, hunger: 18 } },
          },
        ],
      });
      mutation.validate();
      mutation.apply();
      concurrent = worldState(world);
      return world.simulation.prepareDeaths(ids);
    });

    expect(() => commit()).toThrow(/stale|changed/i);
    expect(worldState(world)).toEqual(concurrent);
    expect(world.entities.query({ type: 'world-item' })).toEqual([]);
  });

  it('rejects death effects drift before applying the mixed entity series', () => {
    const world = setup('drop');
    const action = world.simulation.actions.start({ actorId: 'z-dying', type: 'idle' }, 0);
    world.simulation.actions.markRunning(action.id, []);
    let concurrent: ReturnType<typeof worldState> | undefined;
    const commit = prepareNeedsCommit(world, (ids) => {
      const effects = world.simulation.prepareDeaths(ids);
      world.simulation.actions.interruptActor('z-dying', 0, 'concurrent-cancel');
      concurrent = worldState(world);
      return effects;
    });

    expect(() => commit()).toThrow(/stale/i);
    expect(worldState(world)).toEqual(concurrent);
    expect(world.entities.query({ type: 'world-item' })).toEqual([]);
  });

  it('abandons the prepared mixed entity series when death effects preparation fails', () => {
    const world = setup('drop');
    const before = worldState(world);
    const commit = prepareNeedsCommit(world, () => {
      throw new Error('fixture-death-effects-unavailable');
    });

    expect(() => commit()).toThrow('fixture-death-effects-unavailable');
    expect(worldState(world)).toEqual(before);
    expect(world.entities.query({ type: 'world-item' })).toEqual([]);
  });

  it('preflights more than 128 drops and rejects the final allocator slot without partial writes', () => {
    const world = setup('drop');
    const deathIds = ['z-dying'];
    for (let index = 0; index < 6; index++) {
      const id = `z-dying-${index}`;
      deathIds.push(id);
      world.spawnPlayer({ id, position: [4 + index * 2, 2, 0] });
      const actor = world.entities.actorStateAccess(id);
      expect(actor.inventory.add({ itemId: 'sample:filler', count: actor.inventory.capacity })).toBe(true);
    }
    armStarvation(world, deathIds);
    const dropCount = deathIds.reduce(
      (total, id) =>
        total +
        world.entities.actorStateAccess(id).inventory.snapshot().filter(Boolean).length +
        Number(world.entities.actorStateAccess(id).inventoryCursor.stack !== null) +
        world.entities.actorStateAccess(id).inventoryCursor.craftingGrid.filter(Boolean).length +
        Object.values(world.entities.actorStateAccess(id).armor).filter(Boolean).length,
      0,
    );
    expect(dropCount).toBe(148);
    const exhausted = world.createSnapshot();
    exhausted.entityStore.lifetimeHighWater = Number.MAX_SAFE_INTEGER - dropCount + 1;
    world.restoreSnapshot(exhausted);
    expect(world.entities.exportComponentSnapshot().lifetimeHighWater).toBe(Number.MAX_SAFE_INTEGER - dropCount + 1);
    const before = worldState(world);

    expect(() => world.advanceRules(1)).toThrow(/capacity|exhausted/i);
    expect(worldState(world)).toEqual(before);
    expect(world.entities.query({ type: 'world-item' })).toEqual([]);
  });
});
