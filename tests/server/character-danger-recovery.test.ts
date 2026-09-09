import { describe, expect, it } from 'vitest';
import { GameServer } from '../../packages/game-core/src/server/game-server';
import { HeadlessSession } from '../../packages/game-core/src/server/headless/headless-session';
import { MemoryGamePersistence } from '../../packages/game-core/src/server/persistence/memory-game-persistence';
import { testCorePlatform } from '../support/core-platform';

const profile = { name: 'Lin', personality: 'Cautious and practical.', riskTolerance: 0.25 } as const;

const createServer = (seedText: string, persistence?: MemoryGamePersistence) => {
  const server = new GameServer({ platform: testCorePlatform, seedText, persistence });
  server.spawnPlayer({ id: 'player', position: [0.5, 34.6, 0.5] });
  const created = server.character({ kind: 'create', profile, position: [1.5, 34.6, 0.5] });
  if (created.kind !== 'created') throw new Error('Character was not created.');
  return { server, entityId: created.character.entityId };
};

describe('character terminal-goal danger recovery', () => {
  it('uses fallback life after repeated attacks on a succeeded goal and resumes across persistence', async () => {
    const source = await HeadlessSession.create({ platform: testCorePlatform, seedText: 'danger-succeeded' });
    await source.world.clock({ kind: 'pause' });
    const created = await source.world.character({ kind: 'create', profile });
    if (!created.ok || created.data.kind !== 'created') throw new Error('Character was not created.');
    const entityId = created.data.character.entityId;
    const position = source.runtime.server.getEntity(entityId)?.position;
    if (!position) throw new Error('Character position is unavailable.');
    expect(
      await source.world.character({
        kind: 'intent',
        entityId,
        requestId: 'already-complete',
        expectedRevision: 0,
        goal: { kind: 'move-to', position },
      }),
    ).toMatchObject({ ok: true });
    await source.world.clock({ kind: 'advance', elapsedMs: 100 });
    expect(await source.world.character({ kind: 'inspect', entityId })).toMatchObject({
      ok: true,
      data: { character: { currentGoal: { requestId: 'already-complete', status: 'succeeded' } } },
    });

    expect(source.runtime.server.attackEntity(source.runtime.playerId, entityId)).toMatchObject({ success: true });
    await source.world.clock({ kind: 'advance', elapsedMs: 500 });
    const moved = source.runtime.server.getEntity(entityId)?.position;
    if (!moved) throw new Error('Character position is unavailable.');
    source.runtime.setPlayerPosition(moved);
    expect(source.runtime.server.attackEntity(source.runtime.playerId, entityId)).toMatchObject({ success: true });
    await source.world.clock({ kind: 'advance', elapsedMs: 2_900 });
    expect(await source.world.character({ kind: 'inspect', entityId })).toMatchObject({
      ok: true,
      data: { character: { currentGoal: { status: 'suspended' } } },
    });

    const checkpoint = await source.world.checkpoint({ kind: 'export' });
    if (!checkpoint.ok) throw new Error(checkpoint.error.message);
    const restored = await HeadlessSession.create({ platform: testCorePlatform, seedText: 'danger-target' });
    expect(await restored.world.checkpoint({ kind: 'restore', snapshot: checkpoint.data.snapshot })).toMatchObject({
      ok: true,
    });
    await restored.world.clock({ kind: 'advance', elapsedMs: 200 });
    const observation = await restored.world.character({ kind: 'observe', entityId, sinceCursor: 0 });
    expect(observation).toMatchObject({
      ok: true,
      data: {
        observation: {
          character: {
            currentGoal: { requestId: 'fallback-life', goal: { kind: 'forage' }, status: 'active' },
          },
        },
      },
    });
    if (!observation.ok || observation.data.kind !== 'observation')
      throw new Error('Character observation unavailable.');
    expect(
      observation.data.observation.events.filter(
        (event) => event.type === 'fallback' && event.reason === 'danger-cleared',
      ),
    ).toHaveLength(1);
    await source.dispose();
    await restored.dispose();
  });

  it('uses fallback life after an attack on a failed goal without resurrecting it', () => {
    const { server, entityId } = createServer('danger-failed');
    const targetEntity = server.spawnWorldItem([2, 34.6, 0.5], { itemId: 'berry', count: 1 });
    const observed = server.character({ kind: 'observe', entityId });
    if (observed.kind !== 'observation') throw new Error('Character observation unavailable.');
    const target = observed.observation.visibleEntities.find((entry) => entry.stack?.itemId === 'berry')?.target;
    if (!target) throw new Error('Character target is unavailable.');
    server.character({
      kind: 'intent',
      entityId,
      requestId: 'lost-follow-target',
      expectedRevision: 0,
      goal: { kind: 'follow', target },
    });
    server.despawnEntity(targetEntity.id);
    server.advanceGameplayRules(0.1);
    expect(server.character({ kind: 'inspect', entityId })).toMatchObject({
      kind: 'state',
      character: { currentGoal: { requestId: 'lost-follow-target', status: 'failed' } },
    });

    expect(server.attackEntity('player', entityId)).toMatchObject({ success: true, damage: 4 });
    server.advanceGameplayRules(3.1);
    expect(server.character({ kind: 'inspect', entityId })).toMatchObject({
      kind: 'state',
      character: {
        currentGoal: { requestId: 'fallback-life', goal: { kind: 'forage' }, status: 'active' },
      },
    });
  });
});
