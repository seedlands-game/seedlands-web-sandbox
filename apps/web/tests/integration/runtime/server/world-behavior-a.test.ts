import { describe, expect, it } from 'vitest';
import { createLifeBehavior } from '../../../../../../packages/stdlib/src/runtime/character-control-protocol';
import type { CharacterObservation } from '../../../../../../packages/stdlib/src/runtime/character-control-protocol';
import { HeadlessSession } from '../../../../../../packages/stdlib/src/server/headless/headless-session';
import { Voxel } from '../../../../../../packages/stdlib/src/world/voxel';
import { testCorePlatform } from '../../../../../../packages/stdlib/tests/support/core-platform';
import { createCharacterComposition } from '../../../fixtures/classic/character-gameplay';

const profile = { name: 'Mira', personality: 'Steady and curious.', riskTolerance: 0.4 } as const;
const scene = {
  floor: { from: [-8, 56, -12] as const, to: [8, 56, 8] as const },
  air: { from: [-8, 57, -12] as const, to: [8, 61, 8] as const },
  actorPosition: [1.5, 57, 0.5] as const,
  homePosition: [3.5, 57, 4.5] as const,
  patrolPositions: [
    [-4.5, 57, -4.5],
    [4.5, 57, -7.5],
  ] as const,
  food: [
    { position: [4.5, 57, -1.5] as const, count: 64 },
    { position: [3.5, 57, -3.5] as const, count: 64 },
    { position: [-2.5, 57, 2.5] as const, count: 64 },
    { position: [-4.5, 57, -2.5] as const, count: 64 },
  ],
};

async function setupLife() {
  const session = await HeadlessSession.create({
    platform: testCorePlatform,
    seedText: 'npc-continuous-life-v1',
    initialWorldTime: 9,
    createComposition: createCharacterComposition,
  });
  await session.world.clock({ kind: 'pause' });
  for (const entity of session.runtime.server.queryEntities())
    if (entity.id !== session.runtime.playerId)
      expect(await session.world.command({ type: 'despawn-entity', entityId: entity.id })).toMatchObject({
        ok: true,
        data: { success: true },
      });
  expect(
    await session.world.command({ type: 'fill', from: scene.air.from, to: scene.air.to, voxel: Voxel.Air }),
  ).toMatchObject({ ok: true, data: { success: true } });
  expect(
    await session.world.command({ type: 'fill', from: scene.floor.from, to: scene.floor.to, voxel: Voxel.Stone }),
  ).toMatchObject({ ok: true, data: { success: true } });
  expect(await session.world.command({ type: 'teleport', position: [0.5, 57, 0.5] })).toMatchObject({
    ok: true,
    data: { success: true },
  });
  for (const food of scene.food)
    expect(
      await session.world.command({
        type: 'spawn-world-item',
        itemId: 'berry',
        count: food.count,
        position: food.position,
      }),
    ).toMatchObject({ ok: true, data: { success: true } });
  const policy = createLifeBehavior({
    homePosition: scene.homePosition,
    patrolPositions: scene.patrolPositions,
    hungerStart: 40,
    hungerSatisfied: 20,
  });
  const created = await session.world.character({
    kind: 'create',
    profile,
    position: scene.actorPosition,
    homePosition: scene.homePosition,
    behaviorTree: policy,
  });
  if (!created.ok || created.data.kind !== 'created') throw new Error('Life character was not created.');
  return { session, character: created.data.character, policy };
}

async function readAllEvents(session: HeadlessSession, entityId: string, after: number) {
  const events: CharacterObservation['events'][number][] = [];
  let cursor = after;
  let through: number | undefined;
  do {
    const result = await session.world.character({
      kind: 'observe',
      entityId,
      sinceCursor: cursor,
      ...(through === undefined ? {} : { throughCursor: through }),
    });
    if (!result.ok || result.data.kind !== 'observation') throw new Error('Character observation unavailable.');
    through ??= result.data.observation.eventCoverage.through;
    expect(result.data.observation.eventCoverage.lostRange).toBeUndefined();
    events.push(...result.data.observation.events);
    cursor = result.data.observation.cursor;
  } while (cursor < through);
  return { events, cursor };
}

describe('Stage A world behavior', () => {
  it('keeps a RUNNING action identity across compatible replacement and checkpoint rebuild', async () => {
    const { session, character, policy } = await setupLife();
    await session.world.clock({ kind: 'advance', elapsedMs: 500 });
    const first = session.runtime.server.getActorAction(character.entityId);
    expect(first).toMatchObject({ type: 'move-to', status: 'running' });
    const before = await session.world.character({ kind: 'inspect', entityId: character.entityId });
    if (!before.ok || before.data.kind !== 'state') throw new Error('Character state unavailable.');
    expect(
      await session.world.character({
        kind: 'behavior',
        entityId: character.entityId,
        requestId: 'compatible-update',
        expectedBehaviorRevision: before.data.character.behaviorTree.revision,
        ...policy,
      }),
    ).toMatchObject({ ok: true, data: { kind: 'behavior', accepted: true } });
    expect(session.runtime.server.getActorAction(character.entityId)?.id).toBe(first?.id);

    const checkpoint = await session.world.checkpoint({ kind: 'export' });
    if (!checkpoint.ok) throw new Error('Checkpoint unavailable.');
    expect(await session.world.checkpoint({ kind: 'restore', snapshot: checkpoint.data.snapshot })).toMatchObject({
      ok: true,
    });
    expect(session.runtime.server.getActorAction(character.entityId)?.id).toBe(first?.id);
    await session.world.clock({ kind: 'advance', elapsedMs: 500 });
    expect(session.runtime.server.getActorAction(character.entityId)?.id).toBe(first?.id);
    await session.dispose();
  }, 30_000);

  it('emits dialogue rejudge without interrupting the current body action', async () => {
    const { session, character } = await setupLife();
    await session.world.clock({ kind: 'advance', elapsedMs: 200 });
    const action = session.runtime.server.getActorAction(character.entityId);
    expect(action).toMatchObject({ type: 'move-to', status: 'running' });
    expect(
      await session.world.character({ kind: 'dialogue', entityId: character.entityId, text: 'Are you coming?' }),
    ).toMatchObject({ ok: true, data: { kind: 'dialogue' } });
    await session.world.clock({ kind: 'advance', elapsedMs: 100 });
    expect(session.runtime.server.getActorAction(character.entityId)?.id).toBe(action?.id);
    const observed = await readAllEvents(session, character.entityId, 0);
    expect(observed.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'rejudge-requested', nodeId: 'dialogue-monitor', reason: 'dialogue-received' }),
      ]),
    );
    expect(observed.events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'activity-interrupted', actionId: action?.id, reason: 'rejudge' }),
      ]),
    );
    await session.dispose();
  }, 30_000);

  it('lets the installed threat branch arbitrate an attack and emits durable activity facts', async () => {
    const { session, character } = await setupLife();
    await session.world.clock({ kind: 'advance', elapsedMs: 100 });
    expect(session.runtime.server.attackEntity(session.runtime.playerId, character.entityId)).toMatchObject({
      success: true,
    });
    await session.world.clock({ kind: 'advance', elapsedMs: 300 });
    const state = await session.world.character({ kind: 'inspect', entityId: character.entityId });
    expect(state).toMatchObject({
      ok: true,
      data: { character: { behaviorTree: { runtime: { activeNodeIds: ['threat-action'] } } } },
    });
    expect(session.runtime.server.getActorAction(character.entityId)).toMatchObject({
      type: 'move-to',
      status: 'running',
    });
    const observed = await readAllEvents(session, character.entityId, 0);
    expect(observed.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'attacked' }),
        expect.objectContaining({ type: 'rejudge-requested', reason: 'threat-changed' }),
        expect.objectContaining({ type: 'activity-started', nodeId: 'threat-action' }),
      ]),
    );
    await session.dispose();
  }, 30_000);

  it('cancels a changed branch without replay and rejects invalid definitions atomically', async () => {
    const { session, character } = await setupLife();
    await session.world.clock({ kind: 'advance', elapsedMs: 300 });
    const action = session.runtime.server.getActorAction(character.entityId);
    expect(action).toMatchObject({ status: 'running' });
    const before = await session.world.character({ kind: 'inspect', entityId: character.entityId });
    if (!before.ok || before.data.kind !== 'state') throw new Error('Character state unavailable.');
    const invalid = await session.world.character({
      kind: 'behavior',
      entityId: character.entityId,
      requestId: 'bad-tree',
      expectedBehaviorRevision: before.data.character.behaviorTree.revision,
      goal: { description: 'Invalid tree.' },
      definition: { version: 1, root: { id: 'bad', type: 'action', skill: 'write-world-directly' } },
    });
    expect(invalid).toMatchObject({ ok: false, error: { kind: 'validation' } });
    expect(session.runtime.server.getActorAction(character.entityId)?.id).toBe(action?.id);

    expect(
      await session.world.character({
        kind: 'behavior',
        entityId: character.entityId,
        requestId: 'hold-now',
        expectedBehaviorRevision: before.data.character.behaviorTree.revision,
        goal: { description: 'Wait safely.' },
        definition: { version: 1, root: { id: 'replacement-hold', type: 'action', skill: 'hold' } },
      }),
    ).toMatchObject({ ok: true });
    expect(session.runtime.server.getActorAction(character.entityId)).toBeNull();
    expect(action && session.runtime.server.getAction(action.id)).toMatchObject({
      status: 'interrupted',
      reason: 'behavior-replaced',
    });
    const events = await readAllEvents(session, character.entityId, 0);
    expect(events.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'activity-interrupted', actionId: action?.id, reason: 'behavior-replaced' }),
        expect.objectContaining({ type: 'behavior-updated', reason: 'hold-now' }),
      ]),
    );
    await session.dispose();
  }, 30_000);

  it('replans a running movement around a new obstacle without changing action identity', async () => {
    const { session, character } = await setupLife();
    await session.world.clock({ kind: 'advance', elapsedMs: 200 });
    const action = session.runtime.server.getActorAction(character.entityId);
    const waypoint = action?.path[action.pathIndex];
    if (!action || !waypoint) throw new Error('Initial movement path unavailable.');
    expect(
      await session.world.command({
        type: 'set-block',
        position: [Math.floor(waypoint[0]), Math.floor(waypoint[1]), Math.floor(waypoint[2])],
        voxel: Voxel.Stone,
      }),
    ).toMatchObject({ ok: true, data: { success: true } });
    await session.world.clock({ kind: 'advance', elapsedMs: 1_100 });
    const replanned = session.runtime.server.getActorAction(character.entityId);
    expect(replanned?.id).toBe(action.id);
    expect(replanned?.repathCount).toBeGreaterThan(0);
    await session.dispose();
  }, 30_000);

  it('records a bounded navigation failure without teleporting the actor', async () => {
    const { session, character } = await setupLife();
    const before = session.runtime.server.getEntity(character.entityId)?.position;
    expect(
      await session.world.character({
        kind: 'behavior',
        entityId: character.entityId,
        requestId: 'unreachable',
        expectedBehaviorRevision: 1,
        goal: { description: 'Try an unreachable destination.' },
        definition: {
          version: 1,
          root: {
            id: 'far-move',
            type: 'action',
            skill: 'move-to',
            args: { position: [1_000, 57, 1_000], maxReplans: 1 },
          },
        },
      }),
    ).toMatchObject({ ok: true });
    await session.world.clock({ kind: 'advance', elapsedMs: 300 });
    expect(session.runtime.server.getEntity(character.entityId)?.position).toEqual(before);
    const events = await readAllEvents(session, character.entityId, 0);
    expect(events.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'activity-failed',
          nodeId: 'far-move',
          reason: expect.stringMatching(/^path-/),
        }),
      ]),
    );
    await session.dispose();
  }, 30_000);

  it('runs the fixed finite-resource life tree for three simulated days', async () => {
    const { session, character } = await setupLife();
    const facts: CharacterObservation['events'][number][] = [];
    let cursor = 0;
    for (let elapsed = 0; elapsed < 1_800; elapsed += 5) {
      expect(await session.world.clock({ kind: 'advance', elapsedMs: 5_000 })).toMatchObject({ ok: true });
      const page = await readAllEvents(session, character.entityId, cursor);
      facts.push(...page.events);
      cursor = page.cursor;
    }
    const feeding = facts.filter(
      (event) => event.type === 'activity-succeeded' && event.nodeId === 'hunger-action' && (event.hunger ?? 101) <= 20,
    );
    const rests = facts.filter((event) => event.type === 'activity-succeeded' && event.nodeId === 'night-action');
    const patrol = facts.filter(
      (event) => event.type === 'activity-succeeded' && event.nodeId === 'day-patrol' && event.position,
    );
    expect(feeding.length).toBeGreaterThanOrEqual(3);
    expect(rests.length).toBeGreaterThanOrEqual(2);
    expect(patrol.length).toBeGreaterThanOrEqual(4);
    expect(
      session.runtime.server
        .queryEntities({ type: 'world-item' })
        .reduce((sum, entity) => sum + (entity.stack?.count ?? 0), 0),
    ).toBeLessThan(256);
    expect(await session.world.character({ kind: 'inspect', entityId: character.entityId })).toMatchObject({
      ok: true,
      data: { character: { lifecycle: 'active', behaviorTree: { revision: 1 } } },
    });
    await session.dispose();
    // 360 Authority advances plus complete event draining under coverage; this is a hang budget, not a performance metric.
  }, 600_000);
});
