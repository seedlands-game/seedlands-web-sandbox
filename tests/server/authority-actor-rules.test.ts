import { testCorePlatform } from '../support/core-platform';
import { describe, expect, it } from 'vitest';
import { AuthorityRuntime } from '../../packages/game-core/src/server/authority/authority-runtime';
import { GameServer } from '../../packages/game-core/src/server/game-server';
import type { LogicObservation } from '../../packages/game-core/src/server/logic/logic-protocol';
import { MemoryGamePersistence } from '../../packages/game-core/src/server/persistence/memory-game-persistence';
import { voxelIndex, Voxel } from '../../packages/game-core/src/world/voxel';

const clearCell = (server: GameServer, x: number, y: number, z: number) => server.edit(x, y, z, Voxel.Air, 'test');

function combatServer() {
  const server = new GameServer({ platform: testCorePlatform, seedText: 'authority-actor-combat' });
  server.spawnPlayer({ id: 'player', position: [2.5, 1, 0.5] });
  server.spawnAutonomousActor({ id: 'hostile', archetype: 'night-stalker', position: [0.9, 1, 0.5] });
  for (let x = 0; x <= 2; x += 1) {
    clearCell(server, x, 1, 0);
    clearCell(server, x, 2, 0);
  }
  return server;
}

describe('Authority actor rules', () => {
  it('applies one attack, enforces cooldown, and permits a later second attack', () => {
    const server = combatServer();

    expect(server.applyActorAuthorityAction('hostile', { type: 'attack', targetId: 'player' })).toMatchObject({
      accepted: true,
    });
    expect(server.getPlayerState('player').health).toBe(18);
    expect(server.getActorAction('hostile')).toBeNull();
    expect(server.simulationSnapshot().actions.actions.at(-1)).toMatchObject({
      type: 'attack',
      status: 'succeeded',
      result: { damage: 2 },
    });

    expect(server.applyActorAuthorityAction('hostile', { type: 'attack', targetId: 'player' })).toMatchObject({
      accepted: false,
      reason: 'cooldown',
    });
    expect(server.getPlayerState('player').health).toBe(18);

    server.advanceGameplayRules(0.25);
    // Actor rules advance in bounded 100 ms quanta; the unconsumed 50 ms remains in the accumulator.
    expect(server.getActorState('hostile')?.attackCooldownSeconds).toBeCloseTo(0.8, 6);
    expect(server.applyActorAuthorityAction('hostile', { type: 'attack', targetId: 'player' })).toMatchObject({
      accepted: false,
      reason: 'cooldown',
    });
    server.advanceGameplayRules(0.75);
    expect(server.getActorState('hostile')?.attackCooldownSeconds).toBe(0);
    expect(server.applyActorAuthorityAction('hostile', { type: 'attack', targetId: 'player' })).toMatchObject({
      accepted: true,
    });
    expect(server.getPlayerState('player').health).toBe(16);
  });

  it('rejects distant and blocked attacks without canonical side effects', () => {
    const distant = combatServer();
    distant.updateEntity('hostile', { position: [20.5, 1, 0.5] });
    expect(distant.applyActorAuthorityAction('hostile', { type: 'attack', targetId: 'player' })).toMatchObject({
      accepted: false,
      reason: 'out-of-range',
    });
    expect(distant.getPlayerState('player').health).toBe(20);
    expect(distant.simulationSnapshot().actions.actions).toEqual([]);

    const blocked = combatServer();
    blocked.edit(1, 1, 0, Voxel.Stone, 'wall');
    blocked.edit(1, 2, 0, Voxel.Stone, 'wall');
    expect(blocked.applyActorAuthorityAction('hostile', { type: 'attack', targetId: 'player' })).toMatchObject({
      accepted: false,
      reason: 'blocked',
    });
    expect(blocked.getPlayerState('player').health).toBe(20);
    expect(blocked.simulationSnapshot().actions.actions).toEqual([]);
  });

  it('consumes one edible unit, satisfies hunger, and completes the action', () => {
    const server = new GameServer({ platform: testCorePlatform, seedText: 'authority-actor-consume' });
    server.spawnPlayer({ id: 'player', position: [0.5, 1, 0.5] });
    server.spawnAutonomousActor({
      id: 'grazer',
      archetype: 'grazer',
      position: [10.5, 1, 0.5],
      registration: { hunger: 80 },
    });
    server.spawnWorldItem([1.75, 1, 0.5], { itemId: 'berry', count: 2 });
    const food = server.queryEntities({ type: 'world-item' })[0];
    for (let x = 0; x <= 2; x += 1) clearCell(server, x, 1, 0);

    expect(server.applyActorAuthorityAction('grazer', { type: 'consume-world-item', targetId: food.id })).toMatchObject(
      { accepted: false, reason: 'out-of-range' },
    );
    expect(server.getEntity(food.id)?.stack?.count).toBe(2);
    expect(server.getActorState('grazer')?.hunger).toBe(80);
    server.updateEntity('grazer', { position: [1.5, 1, 0.5] });

    expect(server.applyActorAuthorityAction('grazer', { type: 'consume-world-item', targetId: food.id })).toMatchObject(
      { accepted: true },
    );
    expect(server.getEntity(food.id)?.stack).toEqual({ itemId: 'berry', count: 1 });
    expect(server.getActorState('grazer')?.hunger).toBe(0);
    expect(server.simulationSnapshot().actions.actions.at(-1)).toMatchObject({
      type: 'eat',
      status: 'succeeded',
      result: { consumedEntityId: food.id, count: 1 },
    });
  });

  it('completes movement from authoritative positions without moving the actor in the rules lane', () => {
    const server = new GameServer({ platform: testCorePlatform, seedText: 'authority-actor-movement' });
    server.spawnPlayer({ id: 'player', position: [0.5, 1, 0.5] });
    server.spawnAutonomousActor({ id: 'settler', archetype: 'settler', position: [1.5, 1, 0.5] });
    const target: [number, number, number] = [4.5, 1, 0.5];

    expect(server.applyActorAuthorityAction('settler', { type: 'move-to', target })).toMatchObject({ accepted: true });
    expect(server.getActorAction('settler')).toMatchObject({ status: 'running', targetPosition: target });
    server.advanceGameplayRules(0.5);
    expect(server.getEntity('settler')?.position).toEqual([1.5, 1, 0.5]);
    expect(server.getActorAction('settler')).toMatchObject({ status: 'running' });

    server.updateEntity('settler', { position: [4.2, 1, 0.5] });
    server.advanceGameplayRules(0.1);
    expect(server.getActorAction('settler')).toBeNull();
    expect(server.simulationSnapshot().actions.actions.at(-1)).toMatchObject({ status: 'succeeded' });
  });

  it('advances actor needs without invoking the retired navigation and perception loop', () => {
    const server = new GameServer({ platform: testCorePlatform, seedText: 'authority-actor-needs' });
    server.spawnPlayer({ id: 'player', position: [0.5, 1, 0.5] });
    server.spawnAutonomousActor({ id: 'settler', archetype: 'settler', position: [1.5, 1, 0.5] });

    server.advanceGameplayRules(5);

    expect(server.getActorState('settler')?.hunger).toBe(1);
    expect(server.simulationMetrics()).toMatchObject({
      behaviorEvaluationCount: 0,
      navigationPlanCount: 0,
      perceptionLineOfSightCheckCount: 0,
    });
  });

  it('rejects replay of the same observed intent batch before it can consume twice', async () => {
    const observations: LogicObservation[] = [];
    const runtime = await AuthorityRuntime.create({
      platform: testCorePlatform,
      epoch: 'actor-replay',
      seedText: 'authority-actor-replay',
      persistence: new MemoryGamePersistence({ clone: testCorePlatform.clone }),
      initialWorldTime: 9,
      startTimeMs: 0,
      initialPlayerBodyPosition: [0.5, 1, 0.5],
      onLogicObservation: (observation) => observations.push(observation),
    });
    const canonical = new Uint16Array(32 ** 3);
    for (let z = 0; z < 32; z += 1) for (let x = 0; x < 32; x += 1) canonical[voxelIndex(x, 0, z)] = Voxel.Stone;
    const prepared = await runtime.prepareMesh(0, 0, 0);
    expect(runtime.acceptGeneratedChunk({ ...prepared, canonical })).toBe(true);
    runtime.server.spawnAutonomousActor({
      id: 'grazer',
      archetype: 'grazer',
      position: [1.5, 1, 0.5],
      registration: { hunger: 80 },
    });
    const food = runtime.server.spawnWorldItem([1.75, 1, 0.5], { itemId: 'berry', count: 2 });
    runtime.requestLogicObservation();
    runtime.advanceSession(50);
    const observation = observations.at(-1)!;
    const actor = observation.entities.find((entity) => entity.id === 'grazer')!;
    const batch = {
      protocolVersion: 1 as const,
      epoch: 'actor-replay',
      observationSequence: observation.observationSequence,
      expiresAtPhysicsTick: observation.physicsTick + 12,
      intents: [
        {
          entityId: 'grazer',
          identityRevision: actor.identityRevision,
          observedPoseRevision: actor.poseRevision,
          readChunkRevisions: [],
          wish: { x: 0, z: 0 },
          jumpRequested: false,
          verticalIntent: 0 as const,
          action: { type: 'consume-world-item' as const, targetId: food.id },
        },
      ],
    };

    expect(runtime.receiveLogicIntentBatch(batch)).toBe(true);
    expect(runtime.receiveLogicIntentBatch(batch)).toBe(false);
    expect(runtime.server.getEntity(food.id)?.stack).toEqual({ itemId: 'berry', count: 1 });
  });
});
