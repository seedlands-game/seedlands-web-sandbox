import { describe, expect, it } from 'vitest';
import { definePack, type ModModule } from '@seedlands/game-core/mod-api';
import {
  assembleWorldPacks,
  createGameplaySystemAuthority,
  createGameplayActorAuthority,
} from '@seedlands/game-core/server/composition/host-api';
import { pack } from '../../../packages/game-core/src/server/gameplay/playbooks/overworld/pack';
import { GameplayRuntime } from '../../../packages/game-core/src/server/gameplay/gameplay-runtime';
import { testCorePlatform } from '../../support/core-platform';

function setup(withCombat = false, extra: ModModule[] = [], alias = 'test-player', allowOrigins = true) {
  const modules = pack.modules.filter(
    (module) =>
      withCombat || !['seedlands:combat-module', 'seedlands:overworld-combat-rules'].includes(module.descriptor.id),
  );
  modules.push(...extra);
  const selected = definePack({ id: 'test:no-combat', version: '1.0.0', kind: 'playbook', modules });
  const composition = assembleWorldPacks(
    [
      {
        ...selected,
        integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
      },
    ],
    { approvedPermissions: { 'test:no-combat': modules.flatMap((module) => module.descriptor.permissions ?? []) } },
  );
  const actorAuthority = createGameplayActorAuthority(composition.resources, { playerAlias: alias });
  const world = new GameplayRuntime({
    composition,
    moduleSystemAuthority: createGameplaySystemAuthority(composition),
    moduleActorAuthority: {
      forActor: actorAuthority.forActor,
      resolveOrigin: (origin, kind) => (allowOrigins ? actorAuthority.resolveOrigin(origin, kind) : undefined),
    },
    platform: testCorePlatform,
    getWorldTime: () => 9,
    getVoxel: () => 0,
    prepareVoxelEdit: () => {
      throw new Error('unexpected voxel edit');
    },
  });
  world.spawnPlayer({ id: 'alice', position: [0, 0, 0] });
  world.spawnAutonomous(
    { id: 'wolf', type: 'creature', archetype: 'night-stalker', position: [0, 0, 1] },
    { archetype: 'night-stalker' },
  );
  return world;
}
describe('registered Combat is the actual composed consumer', () => {
  it('resolves a player attack through registered policy and retains durable actor origin', () => {
    const world = setup(true);
    const before = world.entities.get('wolf')!.health!;
    const result = world.attackEntity('alice', 'wolf');
    expect(result).toMatchObject({ success: true, damage: 4 });
    expect(world.entities.get('wolf')!.health).toBe(before - 4);
    expect(world.simulation.combat.peekPendingHits()).toEqual([]);
    const snapshot = world.createSnapshot();
    expect(snapshot.simulation.combat?.combatants[0].combat.active).toMatchObject({
      origin: { principalSubject: 'seedlands:local-player', originalActor: { entityId: 'alice' } },
    });
  });
  it('advances an NPC windup through the registered world system and settles damage once', () => {
    const world = setup(true);
    const before = world.entities.get('alice')!.health!;
    expect(world.simulation.requestActorCombat('wolf', 'alice', 'night-stalker-claw').success).toBe(true);
    expect(world.entities.get('alice')!.health).toBe(before);
    world.advanceRules(0.3);
    expect(world.entities.get('alice')!.health).toBe(before - 2);
    world.createSnapshot();
    expect(world.entities.get('alice')!.health).toBe(before - 2);
  });

  it('rejects an after-rule candidate without consuming Actions, Combat, ECS or revision', () => {
    const world = setup(true, [
      {
        descriptor: { id: 'test:reject', version: '1.0.0' },
        register(api) {
          api.registerRule({
            id: 'test:reject-after',
            operationId: 'seedlands:request-combat',
            stage: 'after',
            apply() {
              return { reject: 'denied-by-rules' };
            },
          });
        },
      },
    ]);
    const before = world.createSnapshot();
    expect(world.attackEntity('alice', 'wolf')).toMatchObject({ success: false });
    expect(world.createSnapshot()).toEqual(before);
  });
  it('settles a rejected resolve with a registered cancellation and no damage', () => {
    const world = setup(true, [
      {
        descriptor: { id: 'test:reject', version: '1.0.0' },
        register(api) {
          api.registerRule({
            id: 'test:reject-after',
            operationId: 'seedlands:resolve-combat',
            stage: 'after',
            apply() {
              return { reject: 'immune-by-rules' };
            },
          });
        },
      },
    ]);
    const before = world.entities.get('wolf')!.health;
    expect(world.attackEntity('alice', 'wolf').success).toBe(true);
    expect(world.entities.get('wolf')!.health).toBe(before);
    expect(world.simulation.combat.snapshotFor('alice').lastResult).toMatchObject({ outcome: 'cancelled', damage: 0 });
    expect(world.simulation.actions.forActor('alice')).toBeNull();
    expect(world.simulation.combat.peekPendingHits()).toEqual([]);
  });
  it('restores an NPC windup under a different host alias and damages exactly once', () => {
    const source = setup(true);
    expect(source.simulation.requestActorCombat('wolf', 'alice', 'night-stalker-claw').success).toBe(true);
    source.advanceRules(0.1);
    const target = setup(true, [], 'other-host-player');
    target.restoreSnapshot(source.createSnapshot());
    const before = target.entities.get('alice')!.health!;
    target.advanceRules(0.2);
    expect(target.entities.get('alice')!.health).toBe(before - 2);
    expect(target.simulation.combat.peekPendingHits()).toEqual([]);
  });
  it('cancels a restored player action if its durable subject is no longer authorized', () => {
    const source = setup(true);
    source.giveItem('alice', { itemId: 'wood-sword', count: 1 });
    expect(source.attackEntity('alice', 'wolf').success).toBe(true);
    const target = setup(true, [], 'other-host', false);
    target.restoreSnapshot(source.createSnapshot());
    expect(target.simulation.combat.snapshotFor('alice').active).toBeNull();
    expect(target.simulation.actions.forActor('alice')).toBeNull();
    const health = target.entities.get('wolf')!.health;
    target.advanceRules(0.2);
    expect(target.entities.get('wolf')!.health).toBe(health);
  });
  it('preserves a player windup across host aliases and epoch changes', () => {
    const source = setup(true);
    source.giveItem('alice', { itemId: 'wood-sword', count: 1 });
    expect(source.attackEntity('alice', 'wolf').success).toBe(true);
    source.advanceRules(0.1);
    const target = setup(true, [], 'other-host');
    target.restoreSnapshot(source.createSnapshot());
    const health = target.entities.get('wolf')!.health!;
    target.advanceRules(0.08);
    expect(target.entities.get('wolf')!.health).toBe(health - 5);
  });
  it('commits lethal damage, drops, despawn and Action settlement together', () => {
    const world = setup(true);
    world.entities.update('wolf', { health: 4 });
    expect(world.attackEntity('alice', 'wolf')).toMatchObject({ success: true, damage: 4 });
    expect(world.entities.get('wolf')).toBeNull();
    expect(world.simulation.actorIds()).not.toContain('wolf');
    expect(world.entities.query({ type: 'world-item' }).length).toBeGreaterThan(0);
    expect(() => world.createSnapshot()).not.toThrow();
  });
  it('does not fall back to legacy player or NPC attacks without the Combat provider', () => {
    const world = setup();
    const before = world.createSnapshot();
    expect(world.attackEntity('alice', 'wolf')).toEqual({ success: false, reason: 'combat-unavailable' });
    expect(world.simulation.requestActorCombat('wolf', 'alice', 'night-stalker-claw')).toEqual({
      success: false,
      reason: 'combat-unavailable',
    });
    expect(world.createSnapshot()).toEqual(before);
  });
});
