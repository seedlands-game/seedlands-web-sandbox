import { describe, expect, it } from 'vitest';
import { definePack, type ModModule } from '@seedlands/game-core/mod-api';
import {
  assembleWorldPacks,
  createGameplaySystemAuthority,
  createGameplayActorAuthority,
} from '@seedlands/game-core/server/composition/host-api';
import { pack } from '../../../packages/game-core/src/server/gameplay/playbooks/overworld/pack';
import { WorldResourceAuthorizer } from '../../../packages/game-core/src/server/harness/world-authorization';
import { GameplayRuntime } from '../../../packages/game-core/src/server/gameplay/gameplay-runtime';
import { testCorePlatform } from '../../support/core-platform';

function setup(
  withCombat = false,
  extra: ModModule[] = [],
  alias = 'test-player',
  allowOrigins: boolean | (() => boolean) = true,
) {
  const modules = pack.modules.filter(
    (module) =>
      withCombat ||
      !['seedlands:behavior-registry-module', 'seedlands:combat-module', 'seedlands:overworld-combat-rules'].includes(
        module.descriptor.id,
      ),
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
      resolveOrigin: (origin, kind) =>
        (typeof allowOrigins === 'function' ? allowOrigins() : allowOrigins)
          ? actorAuthority.resolveOrigin(origin, kind)
          : undefined,
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
  it.each([false, true])(
    'preserves the lifecycle Action after lethal first hit and target switch (legacy target fields: %s)',
    (legacyTarget) => {
      const source = setup(true);
      source.entities.update('wolf', { health: 5 });
      const originalTarget = source.entities.createReference('wolf')!;
      source.spawnAutonomous(
        { id: 'wolf-two', type: 'creature', archetype: 'night-stalker', position: [1, 0, 0] },
        { archetype: 'night-stalker' },
      );
      source.giveItem('alice', { itemId: 'wood-sword', count: 1 });
      const attack = source.attackEntity('alice', 'wolf');
      expect(attack.success).toBe(true);
      source.advanceRules(0.18);
      expect(source.entities.get('wolf')).toBeNull();
      expect(source.attackEntity('alice', 'wolf-two')).toMatchObject({ success: true, buffered: true });
      source.advanceRules(0.42);
      expect(source.simulation.combat.snapshotFor('alice').active).toMatchObject({
        comboStep: 1,
        targetId: 'wolf-two',
        phase: 'windup',
      });
      const target = setup(true, [], 'other-host');
      const snapshot = source.createSnapshot();
      const stored = snapshot.simulation.actions.actions.find((action) => action.actorId === 'alice')!;
      expect(stored).not.toHaveProperty('targetEntityId');
      if (legacyTarget) Object.assign(stored, { targetEntityId: 'wolf', targetIdentity: originalTarget });
      target.restoreSnapshot(snapshot);
      expect(target.simulation.actionForActor('alice')).toMatchObject({ targetEntityId: 'wolf-two' });
      expect(target.simulation.actions.forActor('alice')).toMatchObject({
        id: attack.success ? attack.actionId : '',
        status: 'running',
      });
      const health = target.entities.get('wolf-two')!.health!;
      target.advanceRules(0.04);
      expect(target.entities.get('wolf-two')!.health).toBe(health - 7);
    },
  );
  it('drains the accepted request even if a rule rewrites the caller operation ID', () => {
    const request = {
      operationId: 'seedlands:request-combat',
      target: { kind: 'entity' as const, entityId: 'wolf' },
      input: { targetId: 'wolf' },
    };
    const world = setup(true, [
      {
        descriptor: {
          id: 'test:alias',
          version: '1.0.0',
          permissions: [{ resource: 'seedlands.combat', operations: ['execute'] }],
        },
        register(api) {
          api.registerRule({
            id: 'test:alias-after',
            operationId: 'seedlands:request-combat',
            stage: 'after',
            apply() {
              request.operationId = 'test:changed';
            },
          });
        },
      },
    ]);
    const binding = createGameplayActorAuthority(world.resources, { playerAlias: 'test-player' }).forActor(
      'alice',
      'player',
    )!;
    const health = world.entities.get('wolf')!.health!;
    const result = world.invokeModuleOperation(
      binding.authorizer,
      { principalId: binding.principalId, originalActorId: 'alice' },
      request,
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(world.simulation.combat.peekPendingHits()).toEqual([]);
    expect(world.entities.get('wolf')!.health).toBe(health - 4);
  });
  it('surfaces lethal allocation failure and preserves the entire resolve frontier instead of cancelling it', () => {
    const world = setup(true);
    world.entities.update('wolf', { health: 4 });
    const saved = world.createSnapshot();
    saved.entityStore.sequence = Number.MAX_SAFE_INTEGER;
    world.restoreSnapshot(saved);
    const binding = createGameplayActorAuthority(world.resources, { playerAlias: 'test-player' }).forActor(
      'alice',
      'player',
    )!;
    const execution = world.bindModuleOperations(binding.authorizer, {
      moduleId: 'seedlands:combat-module',
      principalId: binding.principalId,
      originalActorId: 'alice',
    });
    expect(
      execution.invoke({
        operationId: 'seedlands:request-combat',
        target: { kind: 'entity', entityId: 'wolf' },
        input: { targetId: 'wolf' },
      }).ok,
    ).toBe(true);
    expect(world.simulation.combat.peekPendingHits()).toHaveLength(1);
    const before = {
      entities: world.entities.exportComponentSnapshot(),
      simulation: world.simulation.snapshot(),
      revision: world.gameplayRevision,
    };
    expect(() => world.createSnapshot()).toThrow(/sequence.*exhausted/i);
    expect({
      entities: world.entities.exportComponentSnapshot(),
      simulation: world.simulation.snapshot(),
      revision: world.gameplayRevision,
    }).toEqual(before);
    execution.dispose();
  });
  it('preserves pending when the current host authority resolver throws an internal TypeError', () => {
    let failed = false;
    const world = setup(true, [], 'test-player', () => {
      if (failed) throw new TypeError('host resolver broken');
      return true;
    });
    const binding = createGameplayActorAuthority(world.resources, { playerAlias: 'test-player' }).forActor(
      'alice',
      'player',
    )!;
    const execution = world.bindModuleOperations(binding.authorizer, {
      moduleId: 'seedlands:combat-module',
      principalId: binding.principalId,
      originalActorId: 'alice',
    });
    expect(
      execution.invoke({
        operationId: 'seedlands:request-combat',
        target: { kind: 'entity', entityId: 'wolf' },
        input: { targetId: 'wolf' },
      }).ok,
    ).toBe(true);
    const before = {
      entities: world.entities.exportComponentSnapshot(),
      simulation: world.simulation.snapshot(),
      revision: world.gameplayRevision,
    };
    failed = true;
    expect(() => world.createSnapshot()).toThrow('host resolver broken');
    expect({
      entities: world.entities.exportComponentSnapshot(),
      simulation: world.simulation.snapshot(),
      revision: world.gameplayRevision,
    }).toEqual(before);
    execution.dispose();
  });
  it('settles equipped Combat in the same registered transfer that removes its weapon', () => {
    const world = setup(true);
    world.giveItem('alice', { itemId: 'wood-sword', count: 1 });
    expect(world.attackEntity('alice', 'wolf').success).toBe(true);
    const authorization = new WorldResourceAuthorizer(
      {
        principals: [{ id: 'transfer', boundEntityId: 'alice' }],
        rules: [
          {
            effect: 'allow',
            resources: ['seedlands.inventory'],
            operations: ['read', 'write', 'execute'],
            scope: 'any',
          },
        ],
      },
      world.resources,
    );
    const execution = world.bindModuleOperations(authorization, {
      principalId: 'transfer',
      moduleId: 'seedlands:inventory-module',
      originalActorId: 'alice',
    });
    expect(
      execution.invoke({
        operationId: 'seedlands:inventory-transfer',
        target: { kind: 'entity', entityId: 'alice' },
        input: { recipientId: 'wolf', itemId: 'wood-sword', count: 1 },
      }).ok,
    ).toBe(true);
    expect(world.simulation.combat.snapshotFor('alice').active).toBeNull();
    expect(world.simulation.actions.forActor('alice')).toBeNull();
    expect(world.getInventory('wolf').slots[0]?.itemId).toBe('wood-sword');
    execution.dispose();
  });
  it.each([false, true])('switches mode with Action and Combat in one prepared commit (exhausted: %s)', (exhausted) => {
    const world = setup(true);
    world.giveItem('alice', { itemId: 'wood-sword', count: 1 });
    expect(world.attackEntity('alice', 'wolf').success).toBe(true);
    if (exhausted) {
      const snapshot = world.createSnapshot();
      snapshot.simulation.combat = { ...snapshot.simulation.combat!, resultSequence: Number.MAX_SAFE_INTEGER };
      world.restoreSnapshot(snapshot);
    }
    const before = world.createSnapshot();
    const authorization = new WorldResourceAuthorizer(
      {
        principals: [{ id: 'mode', boundEntityId: 'alice' }],
        rules: [
          { effect: 'allow', resources: ['seedlands.mode'], operations: ['read', 'write', 'execute'], scope: 'self' },
          { effect: 'allow', resources: ['seedlands.ruleset'], operations: ['read'], scope: 'any' },
        ],
      },
      world.resources,
    );
    const result = world.invokeModuleOperation(
      authorization,
      { principalId: 'mode', originalActorId: 'alice' },
      { operationId: 'seedlands:set-mode', target: { kind: 'entity', entityId: 'alice' }, input: { mode: 'creative' } },
    );
    expect(result.ok, JSON.stringify(result)).toBe(!exhausted);
    if (exhausted) expect(world.createSnapshot()).toEqual(before);
    else {
      expect(world.getActorModeState('alice')?.mode).toBe('creative');
      expect(world.simulation.combat.snapshotFor('alice').active).toBeNull();
      expect(world.simulation.actions.forActor('alice')).toBeNull();
    }
  });
  it('routes the actual creative hotbar selection through registered catalog rules', () => {
    const world = setup(true, [
      {
        descriptor: {
          id: 'test:catalog-veto',
          version: '1.0.0',
          permissions: [{ resource: 'seedlands.mode', operations: ['execute'] }],
        },
        register(api) {
          api.registerRule({
            id: 'test:catalog-veto-rule',
            operationId: 'seedlands:set-creative-catalog',
            stage: 'after',
            apply() {
              return { reject: 'catalog-locked' };
            },
          });
        },
      },
    ]);
    const binding = createGameplayActorAuthority(world.resources, { playerAlias: 'test-player' }).forActor(
      'alice',
      'player',
    )!;
    expect(
      world.invokeModuleOperation(
        binding.authorizer,
        { principalId: binding.principalId, originalActorId: 'alice' },
        {
          operationId: 'seedlands:set-mode',
          target: { kind: 'entity', entityId: 'alice' },
          input: { mode: 'creative' },
        },
      ).ok,
    ).toBe(true);
    const before = world.createSnapshot();
    expect(world.selectHotbarSlot('alice', 1)).toMatchObject({ success: false, reason: 'catalog-locked' });
    expect(world.createSnapshot()).toEqual(before);
  });
  it('settles a player lifecycle Action when a prepared Needs death cancels its target', () => {
    const world = setup(true);
    world.giveItem('alice', { itemId: 'wood-sword', count: 1 });
    expect(world.attackEntity('alice', 'wolf').success).toBe(true);
    const effects = world.simulation.prepareDeaths(['wolf']);
    effects.validate();
    effects.apply();
    expect(world.simulation.combat.snapshotFor('alice').active).toBeNull();
    expect(world.simulation.actions.forActor('alice')).toBeNull();
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
