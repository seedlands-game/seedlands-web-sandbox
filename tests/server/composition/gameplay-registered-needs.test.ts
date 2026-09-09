import { describe, expect, it } from 'vitest';
import { definePack, defineNeedsModule, defineNeedsRulesModule } from '@seedlands/game-core/mod-api';
import {
  assembleWorldPacks,
  assembleOverworldPacks,
  createGameplaySystemAuthority,
} from '@seedlands/game-core/server/composition/host-api';
import { pack } from '../../../packages/game-core/src/server/gameplay/playbooks/overworld/pack';
import {
  type GameplaySnapshotV3,
  createGameplaySnapshotMetadata,
} from '../../../packages/game-core/src/server/gameplay/gameplay-snapshot';
import { GameplayRuntime } from '../../../packages/game-core/src/server/gameplay/gameplay-runtime';
import { WorldResourceAuthorizer } from '../../../packages/game-core/src/server/harness/world-authorization';
import { testCorePlatform } from '../../support/core-platform';

function setup(needs: boolean) {
  const modules = [
    ...pack.modules.filter(
      (module) => !['seedlands:needs-module', 'seedlands:overworld-needs-rules'].includes(module.descriptor.id),
    ),
    ...(needs
      ? [
          defineNeedsModule(),
          defineNeedsRulesModule({
            moduleId: 'test:needs-rules',
            profiles: {
              satiety: {
                enabledModes: ['survival'],
                hungerEverySeconds: 2,
                hungerDelta: -1,
                heal: { threshold: 16, everySeconds: 10, amount: 1, hungerCost: 1 },
                starvation: { threshold: 0, everySeconds: 15, damage: 1 },
              },
              deficit: { enabledModes: ['survival'], hungerEverySeconds: 5, hungerDelta: 1 },
            },
          }),
        ]
      : []),
  ];
  const selected = definePack({ id: 'test:needs-playbook', version: '1.0.0', kind: 'playbook', modules });
  const composition = assembleWorldPacks(
    [
      {
        ...selected,
        integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
      },
    ],
    {
      approvedPermissions: { 'test:needs-playbook': modules.flatMap((module) => module.descriptor.permissions ?? []) },
    },
  );
  const authorizer = new WorldResourceAuthorizer(
    {
      principals: [
        { id: 'schedule', kind: 'system' },
        { id: 'human', boundEntityId: 'alice' },
      ],
      rules: [
        {
          effect: 'allow',
          principal: { ids: ['schedule'] },
          resources: ['seedlands.needs', 'seedlands.ruleset'],
          operations: ['read', 'write', 'execute'],
          scope: 'any',
        },
        {
          effect: 'allow',
          principal: { ids: ['human'] },
          resources: ['seedlands.mode', 'seedlands.ruleset'],
          operations: ['read', 'write', 'execute'],
          scope: 'any',
        },
      ],
    },
    composition.resources,
  );
  const world = new GameplayRuntime({
    composition,
    moduleSystemAuthority: { authorizer, principalId: 'schedule' },
    platform: testCorePlatform,
    allowLegacyCompositionMigration: true,
    getWorldTime: () => 0,
    getVoxel: () => 0,
    prepareVoxelEdit: () => {
      throw new Error('unexpected edit');
    },
  });
  world.spawnPlayer({ id: 'alice', position: [0, 1, 0] });
  return { world, authorizer };
}

function armStarvation(world: GameplayRuntime, ids: readonly string[]) {
  const snapshot = world.createSnapshot();
  for (const actor of snapshot.entityStore.actors)
    if (ids.includes(actor.entityId)) {
      actor.needs.hunger = 0;
      actor.needs.starvationAccumulator = 14;
      const entity = snapshot.entityStore.entities.find((entry) => entry.id === actor.entityId)!;
      entity.health = 1;
    }
  world.restoreSnapshot(snapshot);
}

describe('registered Needs is the real composed consumer', () => {
  it('does not overflow revision after the last valid registered Needs commit', () => {
    const { world } = setup(true);
    const saved = world.createSnapshot();
    saved.revision = Number.MAX_SAFE_INTEGER - 1;
    world.restoreSnapshot(saved);
    world.advanceRules(0.05);
    expect(world.createSnapshot().revision).toBe(Number.MAX_SAFE_INTEGER);
  });
  it('rejects clock advance at exhausted revision before changing a world without Needs', () => {
    const { world } = setup(false);
    const saved = world.createSnapshot();
    saved.revision = Number.MAX_SAFE_INTEGER;
    world.restoreSnapshot(saved);
    const before = world.createSnapshot();
    expect(() => world.advanceRules(0.05)).toThrow(/revision capacity/);
    expect(world.createSnapshot()).toEqual(before);
  });
  it('uses registered Ruleset cadence instead of the old implicit need loop', () => {
    const { world } = setup(true);
    world.advanceRules(2);
    expect(world.getPlayerState('alice').hunger).toBe(19);
    expect(world.createSnapshot().moduleSchedule?.systems).toContainEqual({
      id: 'seedlands:needs-system',
      remainder: 0,
    });
  });
  it('does not consume needs when the composed Playbook omits the module', () => {
    const { world } = setup(false);
    const before = world.entities.actorComponentSnapshot('alice').needs;
    world.advanceRules(120);
    expect(world.entities.actorComponentSnapshot('alice').needs).toEqual(before);
  });
  it('uses the same five-second NPC threshold for 20 Hz steps and one bulk advance', () => {
    const fine = setup(true).world,
      bulk = setup(true).world;
    for (const world of [fine, bulk])
      world.spawnAutonomous(
        { id: 'settler', type: 'npc', archetype: 'settler', position: [1, 1, 0] },
        { archetype: 'settler' },
      );
    for (let step = 0; step < 100; step++) fine.advanceRules(0.05);
    bulk.advanceRules(5);
    expect(fine.entities.actorNeedsSnapshot('settler')).toEqual(bulk.entities.actorNeedsSnapshot('settler'));
    expect(fine.entities.actorNeedsSnapshot('settler').hunger).toBe(1);
  });
  it('keeps fractional needs phase through checkpoint restore', () => {
    const first = setup(true).world;
    first.advanceRules(0.4);
    const saved = first.createSnapshot();
    const restored = setup(true).world;
    restored.restoreSnapshot(saved);
    first.advanceRules(1.6);
    restored.advanceRules(1.6);
    expect(restored.createSnapshot().entityStore).toEqual(first.createSnapshot().entityStore);
    expect(restored.getPlayerState('alice').hunger).toBe(19);
  });
  it('migrates the legacy shared NPC needs phase into per-actor state before the next tick', () => {
    const legacy = new GameplayRuntime({
      platform: testCorePlatform,
      getWorldTime: () => 0,
      getVoxel: () => 0,
      prepareVoxelEdit: () => {
        throw new Error('unexpected edit');
      },
    });
    legacy.spawnPlayer({ id: 'alice', position: [0, 1, 0] });
    legacy.spawnAutonomous(
      { id: 'settler', type: 'npc', archetype: 'settler', position: [1, 1, 0] },
      { archetype: 'settler' },
    );
    legacy.advanceRules(4.4);
    const saved = legacy.createSnapshot();
    const old: GameplaySnapshotV3 = {
      version: 3,
      revision: saved.revision,
      gameplayTime: saved.gameplayTime,
      worldTime: saved.worldTime,
      ...createGameplaySnapshotMetadata(),
      entitySequence: saved.entityStore.sequence,
      entities: saved.entityStore.entities,
      players: [legacy.getPlayerState('alice')],
      simulation: saved.simulation,
    };
    const composition = assembleOverworldPacks([
      {
        ...pack,
        integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
      },
    ]);
    const current = new GameplayRuntime({
      composition,
      moduleSystemAuthority: createGameplaySystemAuthority(composition),
      allowLegacyCompositionMigration: true,
      platform: testCorePlatform,
      getWorldTime: () => 0,
      getVoxel: () => 0,
      prepareVoxelEdit: () => {
        throw new Error('unexpected edit');
      },
    });
    current.restoreSnapshot(old);
    current.advanceRules(0.6);
    expect(current.entities.actorNeedsSnapshot('settler').hunger).toBe(1);
    expect(current.entities.actorNeedsSnapshot('settler').hungerAccumulator).toBeCloseTo(0);
    expect(current.simulation.snapshot().needsAccumulator).toBe(0);
  });
  it('preflights all partition deaths and leaves ECS and Combat unchanged on the last drop allocation failure', () => {
    const { world } = setup(true);
    const ids = ['alice'];
    for (let index = 1; index < 128; index++) {
      const id = `p${index.toString().padStart(3, '0')}`;
      ids.push(id);
      world.spawnPlayer({ id, position: [index * 2, 1, 0] });
    }
    const membership = world.entities.exportComponentSnapshot();
    expect(() => world.spawnPlayer({ id: 'overflow', position: [0, 1, 0] })).toThrow(/membership budget/i);
    expect(world.entities.exportComponentSnapshot()).toEqual(membership);
    world.spawnAutonomous(
      { id: 'a-npc', type: 'npc', archetype: 'settler', position: [0, 1, 5] },
      { archetype: 'settler' },
    );
    for (const id of ids) world.giveItem(id, { itemId: 'wood-block', count: 1 });
    armStarvation(world, ids);
    const exhausted = world.createSnapshot();
    exhausted.entityStore.sequence = Number.MAX_SAFE_INTEGER - 127;
    world.restoreSnapshot(exhausted);
    const before = world.entities.exportComponentSnapshot();
    const combat = world.simulation.combat.snapshot();
    expect(() => world.advanceRules(1)).toThrow(/sequence.*exhausted/i);
    expect(world.entities.exportComponentSnapshot()).toEqual(before);
    expect(world.simulation.combat.snapshot()).toEqual(combat);
    expect(world.queryEntities({ type: 'world-item' })).toEqual([]);
  });
  it('commits starvation death and cancels an incoming combat action in the same prepared effects', () => {
    const { world } = setup(true);
    world.giveItem('alice', { itemId: 'wood-block', count: 3 });
    world.spawnAutonomous(
      { id: 'stalker', type: 'creature', archetype: 'night-stalker', position: [1, 1, 0] },
      { archetype: 'night-stalker' },
    );
    const attack = world.simulation.requestActorCombat('stalker', 'alice', 'night-stalker-claw');
    expect(attack.success).toBe(true);
    armStarvation(world, ['alice']);
    world.advanceRules(1);
    expect(world.getPlayerState('alice')).toMatchObject({ health: 0, lifecycle: 'dead' });
    expect(world.queryEntities({ type: 'world-item' })).toMatchObject([{ stack: { itemId: 'wood-block', count: 3 } }]);
    expect(world.simulation.actions.forActor('stalker')).toBeNull();
    expect(world.simulation.combatSnapshotFor('stalker').active).toBeNull();
  });
  it('applies creative exemption through Ruleset while other actors remain in survival', () => {
    const { world, authorizer } = setup(true);
    world.spawnPlayer({ id: 'bob', position: [2, 1, 0] });
    expect(
      world.invokeModuleOperation(
        authorizer,
        { principalId: 'human', originalActorId: 'alice' },
        {
          operationId: 'seedlands:set-mode',
          target: { kind: 'entity', entityId: 'alice' },
          input: { mode: 'creative' },
        },
      ),
    ).toMatchObject({ ok: true });
    world.advanceRules(2);
    expect(world.getPlayerState('alice').hunger).toBe(20);
    expect(world.getPlayerState('bob').hunger).toBe(19);
  });
});
