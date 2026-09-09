import { describe, expect, it } from 'vitest';
import { testCorePlatform } from '../support/core-platform';
import { GameServer } from '../../packages/game-core/src/server/game-server';
import { GameplayRuntime } from '../../packages/game-core/src/server/gameplay/gameplay-runtime';
import { ItemIds } from '../../packages/game-core/src/server/gameplay/item-registry';
import {
  CombatRuntime,
  type CombatRuntimeCallbacks,
} from '../../packages/game-core/src/server/gameplay/combat-runtime';
import type {
  EntityIdentityPort,
  EntityLifetimeReference,
} from '../../packages/game-core/src/server/simulation/action-identity';
import { Voxel } from '../../packages/game-core/src/world/voxel';

const identities = (initial: Readonly<Record<string, number>>) => {
  const lifetimes = new Map(Object.entries(initial));
  const referenceFor = (entityId: string): EntityLifetimeReference | null => {
    const lifetime = lifetimes.get(entityId);
    return lifetime === undefined ? null : { entityId, epoch: 1, lifetime };
  };
  const port: EntityIdentityPort = {
    referenceFor,
    resolve: (reference) => {
      const current = referenceFor(reference.entityId);
      return current?.lifetime === reference.lifetime ? reference.entityId : null;
    },
    rebind: (reference) => {
      const current = referenceFor(reference.entityId);
      return current?.lifetime === reference.lifetime ? current : null;
    },
  };
  return { port, remove: (entityId: string) => lifetimes.delete(entityId) };
};

const recordingCallbacks = (hits: number[]): CombatRuntimeCallbacks => ({
  actorAvailable: () => true,
  targetAvailable: () => true,
  validateHit: () => null,
  applyDamage: (_actorId, _targetId, damage) => {
    hits.push(damage);
    return damage;
  },
});

const openWorld = () => {
  const runtime = new GameplayRuntime({
    getVoxel: () => Voxel.Air,
    editVoxel: () => {
      throw new Error('unexpected edit');
    },
    getWorldTime: () => 9,
    platform: testCorePlatform,
  });
  runtime.spawnPlayer({ id: 'player', position: [0.5, 1, 0.5] });
  runtime.spawn({
    id: 'target',
    type: 'creature',
    archetype: 'grazer',
    position: [2.5, 1, 0.5],
    health: 5,
    maxHealth: 5,
  });
  return runtime;
};

describe('combat lethal hit recovery', () => {
  it('completes one committed lethal hit after its target is despawned', () => {
    const host = identities({ actor: 1, target: 2 });
    const hits: number[] = [];
    const runtime = new CombatRuntime(
      {
        ...recordingCallbacks(hits),
        applyDamage: (_actorId, targetId, damage) => {
          hits.push(damage);
          host.remove(targetId);
          return damage;
        },
      },
      undefined,
      host.port,
    );

    const requested = runtime.request('actor', 'target', 'wood-sword');
    expect(requested).toMatchObject({ success: true, actionId: 'combat-1' });
    runtime.advance(0.18);

    expect(hits).toEqual([5]);
    expect(runtime.snapshotFor('actor')).toMatchObject({
      active: { phase: 'hit' },
      lastResult: { outcome: 'hit', damage: 5, targetId: 'target' },
    });
    expect(runtime.retain('actor', 'combat-1')).toMatchObject({ success: true });

    runtime.advance(1);
    expect(hits).toEqual([5]);
    expect(runtime.snapshotFor('actor')).toMatchObject({
      active: null,
      lastResult: { outcome: 'hit', damage: 5, targetId: 'target' },
    });
    expect(runtime.takeLifecycleEvents()).toEqual([
      expect.objectContaining({ status: 'completed', result: expect.objectContaining({ outcome: 'hit', damage: 5 }) }),
    ]);
  });

  it('rejects a stale windup target and validates a buffered target before its hit', () => {
    const staleHost = identities({ actor: 1, target: 2 });
    const staleHits: number[] = [];
    const stale = new CombatRuntime(recordingCallbacks(staleHits), undefined, staleHost.port);
    stale.request('actor', 'target', 'wood-sword');
    staleHost.remove('target');
    stale.advance(0.18);
    expect(staleHits).toEqual([]);
    expect(stale.snapshotFor('actor').lastResult).toMatchObject({ outcome: 'cancelled', reason: 'target-missing' });

    const bufferedHost = identities({ actor: 1, first: 2, second: 3 });
    const bufferedHits: number[] = [];
    const buffered = new CombatRuntime(recordingCallbacks(bufferedHits), undefined, bufferedHost.port);
    buffered.request('actor', 'first', 'wood-sword');
    buffered.advance(0.18);
    expect(buffered.request('actor', 'second', 'wood-sword')).toMatchObject({ success: true, buffered: true });
    bufferedHost.remove('second');
    buffered.advance(0.5);
    expect(bufferedHits).toEqual([5]);
    expect(buffered.snapshotFor('actor').lastResult).toMatchObject({
      outcome: 'cancelled',
      comboStep: 1,
      targetId: 'second',
      reason: 'target-missing',
    });
  });

  it.each([
    ['hit', 0.18],
    ['recovery', 0.27],
  ] as const)('restores a committed %s phase after target deletion without replaying damage', (phase, elapsed) => {
    const host = identities({ actor: 1, target: 2 });
    const hits: number[] = [];
    const source = new CombatRuntime(recordingCallbacks(hits), undefined, host.port);
    source.request('actor', 'target', 'wood-sword');
    source.advance(elapsed);
    expect(source.snapshotFor('actor')).toMatchObject({ active: { phase }, lastResult: { outcome: 'hit', damage: 5 } });
    const snapshot = source.snapshot();
    host.remove('target');

    const restored = new CombatRuntime(recordingCallbacks(hits), undefined, host.port);
    restored.restore(snapshot);
    expect(restored.snapshotFor('actor')).toMatchObject({
      active: { phase },
      lastResult: { outcome: 'hit', damage: 5, targetId: 'target' },
    });
    restored.advance(1);
    expect(hits).toEqual([5]);
    expect(restored.snapshotFor('actor')).toMatchObject({
      active: null,
      lastResult: { outcome: 'hit', damage: 5, targetId: 'target' },
    });
  });

  it('restores a committed hit before rejecting its deleted buffered target', () => {
    const host = identities({ actor: 1, first: 2, second: 3 });
    const hits: number[] = [];
    const source = new CombatRuntime(recordingCallbacks(hits), undefined, host.port);
    source.request('actor', 'first', 'wood-sword');
    source.advance(0.18);
    source.request('actor', 'second', 'wood-sword');
    const snapshot = source.snapshot();
    host.remove('second');

    const restored = new CombatRuntime(recordingCallbacks(hits), undefined, host.port);
    restored.restore(snapshot);
    expect(restored.snapshotFor('actor')).toMatchObject({
      active: { phase: 'hit', buffered: true },
      lastResult: { outcome: 'hit', comboStep: 0, damage: 5 },
    });
    restored.advance(0.5);
    expect(hits).toEqual([5]);
    expect(restored.snapshotFor('actor')).toMatchObject({
      active: null,
      lastResult: { outcome: 'cancelled', comboStep: 1, targetId: 'second', reason: 'target-missing' },
    });
  });

  it('preserves lethal player-to-NPC results and NPC Action completion through shared gameplay combat', () => {
    const gameplay = openWorld();
    gameplay.giveItem('player', { itemId: ItemIds.WoodSword, count: 1 });
    gameplay.attackEntity('player', 'target');
    gameplay.advanceRules(0.18);
    expect(gameplay.getEntity('target')).toBeNull();
    expect(gameplay.getPlayerState('player').combat).toMatchObject({
      active: { phase: 'hit' },
      lastResult: { outcome: 'hit', damage: 5 },
    });
    const restoredGameplay = openWorld();
    restoredGameplay.restoreSnapshot(gameplay.createSnapshot());
    expect(restoredGameplay.getEntity('target')).toBeNull();
    expect(restoredGameplay.getPlayerState('player').combat).toMatchObject({
      active: { phase: 'hit' },
      lastResult: { outcome: 'hit', damage: 5 },
    });
    restoredGameplay.advanceRules(1);
    expect(restoredGameplay.getPlayerState('player').combat).toMatchObject({
      active: null,
      lastResult: { outcome: 'hit', damage: 5 },
    });
    gameplay.advanceRules(1);
    expect(gameplay.getPlayerState('player').combat).toMatchObject({
      active: null,
      lastResult: { outcome: 'hit', damage: 5 },
    });

    const server = new GameServer({ platform: testCorePlatform, seedText: 'lethal-action-recovery' });
    server.spawnPlayer({ id: 'player', position: [2.5, 1, 0.5] });
    server.spawnAutonomousActor({ id: 'hostile', archetype: 'night-stalker', position: [0.9, 1, 0.5] });
    for (let x = 0; x <= 2; x += 1) {
      server.edit(x, 1, 0, Voxel.Air, 'fixture');
      server.edit(x, 2, 0, Voxel.Air, 'fixture');
    }
    server.applyDamage('fixture', 'player', 18, 'fixture');
    expect(server.applyActorAuthorityAction('hostile', { type: 'attack', targetId: 'player' })).toMatchObject({
      accepted: true,
      action: { id: 'action-1', status: 'running' },
    });
    server.advanceGameplayRules(0.35);
    expect(server.getPlayerState('player').health).toBe(0);
    expect(server.getCombatState('hostile').lastResult).toMatchObject({ outcome: 'hit', damage: 2 });
    server.advanceGameplayRules(0.65);
    expect(server.getAction('action-1')).toMatchObject({
      status: 'succeeded',
      result: { outcome: 'hit', damage: 2 },
    });
  });
});
