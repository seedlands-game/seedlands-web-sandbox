import { describe, expect, it } from 'vitest';
import {
  assembleOverworldPacks,
  createGameplaySystemAuthority,
} from '@seedlands/game-core/server/composition/host-api';
import { pack } from '../../../packages/game-core/src/server/gameplay/playbooks/overworld/pack';
import { GameplayRuntime } from '../../../packages/game-core/src/server/gameplay/gameplay-runtime';
import { WorldResourceAuthorizer } from '../../../packages/game-core/src/server/harness/world-authorization';
import { testCorePlatform } from '../../support/core-platform';

function setup(allow = true, floor = true) {
  const composition = assembleOverworldPacks([
    {
      ...pack,
      integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
    },
  ]);
  const gameplay = new GameplayRuntime({
    composition,
    moduleSystemAuthority: createGameplaySystemAuthority(composition),
    platform: testCorePlatform,
    getWorldTime: () => 0,
    getVoxel: ([, y]) => (floor ? (y === 0 ? 3 : 0) : undefined),
    prepareVoxelEdit: () => {
      throw new Error('unexpected edit');
    },
  });
  gameplay.spawnPlayer({ id: 'alice', position: [0.5, 3, 0.5] });
  gameplay.giveItem('alice', { itemId: 'wood-block', count: 3 });
  const authorizer = new WorldResourceAuthorizer(
    {
      principals: [{ id: 'human', boundEntityId: 'alice' }],
      rules: allow
        ? [
            { effect: 'allow', resources: ['seedlands.ruleset'], operations: ['read'], scope: 'any' },
            {
              effect: 'allow',
              principal: { ids: ['human'] },
              resources: ['seedlands.mode'],
              operations: ['read', 'write', 'execute'],
              scope: 'self',
            },
          ]
        : [],
    },
    composition.resources,
  );
  const binding = gameplay.bindModuleOperations(authorizer, {
    moduleId: 'seedlands:mode-module',
    principalId: 'human',
    originalActorId: 'alice',
  });
  const setMode = (mode: string) =>
    binding.invoke({
      operationId: 'seedlands:set-mode',
      target: { kind: 'entity', entityId: 'alice' },
      input: { mode },
    });
  return { gameplay, binding, setMode, authorizer };
}

describe('composed mode operations with actual ECS and physical landing', () => {
  it('switches creative and safely returns while preserving survival slots and needs', () => {
    const { gameplay, setMode } = setup();
    const inventory = gameplay.getInventory('alice');
    expect(setMode('creative')).toMatchObject({ ok: true });
    expect(gameplay.getActorModeState('alice')).toMatchObject({ mode: 'creative', flight: { enabled: true } });
    const needs = gameplay.getPlayerState('alice');
    gameplay.advanceRules(30);
    gameplay.applyDamage('test', 'alice', 4, 'test');
    expect(gameplay.getPlayerState('alice')).toMatchObject({ health: needs.health, hunger: needs.hunger });
    expect(setMode('survival')).toMatchObject({ ok: true });
    expect(gameplay.getEntity('alice')!.position[1]).toBeCloseTo(1);
    expect(gameplay.getActorModeState('alice')).toMatchObject({ mode: 'survival', flight: { enabled: false } });
    expect(gameplay.getInventory('alice')).toEqual(inventory);
  });
  it('keeps all state on permission denial or unknown safe landing', () => {
    const denied = setup(false),
      before = denied.gameplay.createSnapshot();
    expect(denied.setMode('creative')).toMatchObject({ ok: false, code: 'WORLD_PERMISSION_DENIED' });
    expect(denied.gameplay.createSnapshot()).toEqual(before);
    const unknown = setup(true, false);
    expect(unknown.setMode('creative')).toMatchObject({ ok: true });
    const creative = unknown.gameplay.createSnapshot();
    expect(unknown.setMode('survival')).toMatchObject({ ok: false });
    expect(unknown.gameplay.createSnapshot()).toEqual(creative);
  });
  it('rejects synchronous reentry across two bindings to the same world and drains queued work later', () => {
    const world = setup();
    const second = world.gameplay.bindModuleOperations(world.authorizer, {
      moduleId: 'seedlands:mode-module',
      principalId: 'human',
      originalActorId: 'alice',
    });
    let nested: unknown;
    const request = {
      operationId: 'seedlands:set-flight',
      target: { kind: 'entity' as const, entityId: 'alice' },
      input: { enabled: false },
    };
    const unsubscribe = world.binding.subscribe((_fact, enqueue) => {
      nested = second.invoke(request);
      expect(enqueue(request)).toBe(true);
      unsubscribe();
    });
    expect(world.setMode('creative')).toMatchObject({ ok: true });
    expect(nested).toMatchObject({ ok: false, code: 'TRANSACTION_REENTRANT' });
    expect(world.gameplay.getActorModeState('alice')!.flight.enabled).toBe(true);
    const beforeInvalidAdvance = world.gameplay.createSnapshot();
    expect(() => world.gameplay.advanceRules(-1)).toThrow();
    expect(world.gameplay.createSnapshot()).toEqual(beforeInvalidAdvance);
    world.gameplay.advanceRules(0.05);
    expect(world.gameplay.getActorModeState('alice')!.flight.enabled).toBe(false);
  });

  it('drains a bounded queue before snapshot and refuses a still-pending frontier', () => {
    const world = setup();
    let enabled = false;
    const unsubscribe = world.binding.subscribe((_fact, enqueue) => {
      expect(
        enqueue({
          operationId: 'seedlands:set-flight',
          target: { kind: 'entity', entityId: 'alice' },
          input: { enabled },
        }),
      ).toBe(true);
      enabled = !enabled;
    });
    expect(world.setMode('creative')).toMatchObject({ ok: true });
    expect(() => world.gameplay.createSnapshot()).toThrow(/snapshot frontier budget/i);
    unsubscribe();
    const saved = world.gameplay.createSnapshot();
    expect(saved.moduleSchedule?.time).toBe(saved.gameplayTime);
    const restored = setup();
    restored.gameplay.restoreSnapshot(saved);
    expect(restored.gameplay.getActorModeState('alice')).toEqual(world.gameplay.getActorModeState('alice'));
    world.gameplay.dispose();
    restored.gameplay.dispose();
  });

  it('restores mode and invalidates retained operation bindings after restore or respawn', () => {
    const world = setup();
    expect(world.setMode('creative')).toMatchObject({ ok: true });
    const saved = world.gameplay.createSnapshot();
    world.gameplay.restoreSnapshot(saved);
    expect(world.gameplay.getActorModeState('alice')).toMatchObject({ mode: 'creative' });
    expect(world.setMode('survival')).toMatchObject({ ok: false, code: 'ACTOR_REFERENCE_STALE' });
    const replaced = setup();
    replaced.gameplay.despawnEntity('alice');
    expect(() => replaced.gameplay.spawnPlayer({ id: 'alice', position: [0.5, 1, 0.5] })).toThrow('retired');
    replaced.gameplay.spawnPlayer({ id: 'new-actor', position: [0.5, 1, 0.5] });
    expect(replaced.setMode('creative')).toMatchObject({ ok: false, code: 'ACTOR_REFERENCE_STALE' });
  });
});
