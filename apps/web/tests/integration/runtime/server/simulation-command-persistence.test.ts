import { testCorePlatform } from '../../../../../../packages/stdlib/tests/support/core-platform';
import { describe, expect, it } from 'vitest';
import {
  ALL_COMMAND_CAPABILITIES,
  ServerCommandExecutor,
} from '../../../../../../packages/stdlib/src/server/commands/server-command-executor';
import { parseSlashCommand } from '../../../../../../packages/stdlib/src/server/commands/slash-command-parser';
import { GameServer } from '../../../fixtures/classic/content';
import { MemoryGamePersistence } from '../../../../../../packages/stdlib/src/server/persistence/memory-game-persistence';
import { isSolid, Voxel } from '../../../../../../packages/stdlib/src/world/voxel';

const developer = {
  actorId: 'developer',
  sourceType: 'local-developer' as const,
  entityId: 'player',
  capabilities: ALL_COMMAND_CAPABILITIES,
};

const starterEcologySeeds = [
  'living-world-autonomy',
  'ridge-start',
  'river-start',
  'coast-start',
  'highland-start',
] as const;

describe('simulation commands and persistence', () => {
  it('keeps low-level commands reusable after ingress authorization resolves the observer identity', async () => {
    const server = new GameServer({ platform: testCorePlatform, seedText: 'simulation-command' });
    server.spawnPlayer({ id: 'player', position: [0.5, 1, 0.5] });
    server.spawnAutonomousActor({ id: 'settler', archetype: 'settler', position: [2.5, 1, 0.5] });
    server.registerPoi({ id: 'work', kind: 'work', position: [4.5, 1, 0.5], label: '工作地' });
    const executor = new ServerCommandExecutor(server, { now: testCorePlatform.now });
    const scriptedSource = {
      actorId: 'settler',
      sourceType: 'scripted-test',
      entityId: 'settler',
      capabilities: ['query', 'mutation'] as const,
    };

    await expect(executor.execute(scriptedSource, { type: 'query-observation' })).resolves.toMatchObject({
      success: true,
    });
    await expect(executor.execute(developer, { type: 'query-observation' })).resolves.toMatchObject({
      success: true,
      data: { observation: { observerId: 'player' } },
    });
    await expect(
      executor.execute(scriptedSource, { type: 'query-observation', entityId: 'player' }),
    ).resolves.toMatchObject({
      success: true,
      data: { observation: { observerId: 'player' } },
    });
    const move = await executor.execute(scriptedSource, {
      type: 'start-action',
      action: 'move-to',
      position: [4.5, 1, 0.5],
    });
    expect(move).toMatchObject({ success: true, data: { action: { actorId: 'settler', status: 'pending' } } });
    await expect(executor.execute(scriptedSource, { type: 'query-action' })).resolves.toMatchObject({ success: true });
    await expect(executor.execute(scriptedSource, { type: 'query-pois', radius: 10 })).resolves.toMatchObject({
      success: true,
      data: { pois: [expect.objectContaining({ id: 'work' })] },
    });
  });

  it('parses the minimal human-facing summon, observation, action, path and POI surface', () => {
    expect(parseSlashCommand('/summon grazer 1 2 3')).toMatchObject({
      success: true,
      command: { type: 'spawn-actor', archetype: 'grazer', position: [1, 2, 3] },
    });
    expect(parseSlashCommand('/observe settler-1')).toMatchObject({
      success: true,
      command: { type: 'query-observation', entityId: 'settler-1' },
    });
    expect(parseSlashCommand('/entity move settler-1 3 2 1')).toMatchObject({
      success: true,
      command: { type: 'start-action', entityId: 'settler-1', action: 'move-to', position: [3, 2, 1] },
    });
    expect(parseSlashCommand('/entity stop settler-1')).toMatchObject({
      success: true,
      command: { type: 'interrupt-action', entityId: 'settler-1' },
    });
    expect(parseSlashCommand('/path settler-1 4 2 0')).toMatchObject({
      success: true,
      command: { type: 'query-path', entityId: 'settler-1', position: [4, 2, 0] },
    });
    expect(parseSlashCommand('/poi nearby settler-1 10')).toMatchObject({
      success: true,
      command: { type: 'query-pois', entityId: 'settler-1', radius: 10 },
    });
  });

  it('bounds global developer observation, POI and path queries', async () => {
    const server = new GameServer({ platform: testCorePlatform, seedText: 'bounded-developer-query' });
    server.spawnPlayer({ id: 'player', position: [0.5, 1, 0.5] });
    const executor = new ServerCommandExecutor(server, { now: testCorePlatform.now });

    for (const command of [
      { type: 'query-observation', range: 257 },
      { type: 'query-pois', radius: 257 },
      { type: 'query-path', position: [257, 1, 0.5] },
    ] as const) {
      await expect(executor.execute(developer, command)).resolves.toMatchObject({
        success: false,
        error: { kind: 'execution' },
      });
    }
  });

  it('roundtrips V2 actor, POI, action and world time without duplicate starter content', async () => {
    const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
    const server = new GameServer({ platform: testCorePlatform, seedText: 'simulation-save', persistence });
    server.setWorldTime(22.5);
    server.spawnPlayer({ id: 'player', position: [0.5, 1, 0.5] });
    server.spawnAutonomousActor({ id: 'settler', archetype: 'settler', position: [2.5, 1, 0.5] });
    server.registerPoi({ id: 'home', kind: 'home', position: [3.5, 1, 0.5], label: '住所' });
    server.startActorAction('settler', { type: 'go-to-poi', poiId: 'home' });
    await server.save();

    const restored = new GameServer({ platform: testCorePlatform, seedText: 'simulation-save', persistence });
    restored.setWorldTime(9.5);
    await restored.restore();
    expect(restored.worldTime).toBe(22.5);
    expect(restored.getActorState('settler')).toMatchObject({ archetype: 'settler' });
    expect(restored.getPoi('home')).toMatchObject({ label: '住所' });
    expect(restored.queryEntities({ type: 'npc' })).toHaveLength(1);
    expect(restored.initializeStarterEcology([0.5, 1, 0.5])).toMatchObject({ initialized: false });
  });

  it('migrates V1 without resetting the caller default clock and rejects malformed V2', async () => {
    const v1 = {
      version: 1,
      revision: 1,
      gameplayTime: 0,
      entitySequence: 1,
      entities: [{ id: 'player', type: 'player', kind: 'player', lifecycle: 'active', position: [0.5, 1, 0.5] }],
      players: [
        {
          entityId: 'player',
          spawnPosition: [0.5, 1, 0.5],
          health: 20,
          maxHealth: 20,
          hunger: 20,
          maxHunger: 20,
          lifecycle: 'alive',
          inventory: Array.from({ length: 24 }, () => null),
          selectedSlot: 0,
          hotbarSize: 8,
          attackCooldownSeconds: 0,
          hungerAccumulator: 0,
          healingAccumulator: 0,
          starvationAccumulator: 0,
          breakAction: null,
        },
      ],
    };
    const migrated = new GameServer({
      platform: testCorePlatform,
      seedText: 'v1',
      persistence: new MemoryGamePersistence({ clone: testCorePlatform.clone, rawGameplaySnapshot: v1 }),
    });
    migrated.setWorldTime(9.5);
    await migrated.restore();
    expect(migrated.worldTime).toBe(9.5);
    expect(migrated.simulationSnapshot()).toMatchObject({ actors: [], starterEcologyVersion: 0 });

    const malformed = new GameServer({
      platform: testCorePlatform,
      seedText: 'bad-v2',
      persistence: new MemoryGamePersistence({
        clone: testCorePlatform.clone,
        rawGameplaySnapshot: { ...v1, version: 2, worldTime: 99 },
      }),
    });
    await expect(malformed.restore()).rejects.toThrow(/Invalid gameplay snapshot/);
  });

  it('spawns the three actor types through the same command executor without a second simulation clock', async () => {
    const server = new GameServer({ platform: testCorePlatform, seedText: 'headless-autonomy' });
    server.spawnPlayer({ id: 'player', position: [0.5, 1, 0.5] });
    const executor = new ServerCommandExecutor(server, { now: testCorePlatform.now });
    for (const archetype of ['grazer', 'night-stalker', 'settler'] as const) {
      const result = await executor.execute(developer, {
        type: 'spawn-actor',
        archetype,
        position: [2.5, 1, archetype === 'settler' ? 2.5 : 0.5],
      });
      expect(result.success).toBe(true);
    }
    expect(server.simulationMetrics()).toMatchObject({ retainedActorCount: 3, behaviorEvaluationCount: 0 });
  });

  it.each(starterEcologySeeds)('places starter actors on bounded dry surfaces for seed %s', (seedText) => {
    const server = new GameServer({ platform: testCorePlatform, seedText });
    expect(server.initializeStarterEcology([0, 34, 0]).initialized).toBe(true);
    const actors = server.queryEntities().filter((entity) => entity.archetype);
    expect(actors).toHaveLength(3);
    for (const actor of actors) {
      const [x, y, z] = actor.position.map(Math.floor);
      expect(server.getVoxel(x, y, z), `${seedText}:${actor.id}:feet`).toBe(Voxel.Air);
      expect(server.getVoxel(x, y + 1, z), `${seedText}:${actor.id}:head`).toBe(Voxel.Air);
      expect(isSolid(server.getVoxel(x, y - 1, z)), `${seedText}:${actor.id}:ground`).toBe(true);
      expect(Math.hypot(actor.position[0], actor.position[2]), `${seedText}:${actor.id}:radius`).toBeLessThanOrEqual(
        24,
      );
    }
  });
});
