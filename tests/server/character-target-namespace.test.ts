import { describe, expect, it } from 'vitest';
import { GameServer } from '../../packages/game-core/src/server/game-server';
import { Voxel } from '../../packages/game-core/src/world/voxel';
import { testCorePlatform } from '../support/core-platform';

const profile = { name: 'Lin', personality: 'Cautious, practical, and kind.', riskTolerance: 0.25 } as const;
const sharedTargetId = 'shared-landmark';

const setup = () => {
  const server = new GameServer({ platform: testCorePlatform, seedText: 'character-target-namespace' });
  server.editBatch({
    actorId: 'fixture',
    edits: Array.from({ length: 15 }, (_, x) => [
      { x, y: 33, z: 0, value: Voxel.Stone },
      { x, y: 34, z: 0, value: Voxel.Air },
      { x, y: 35, z: 0, value: Voxel.Air },
    ]).flat(),
  });
  server.spawnPlayer({ id: sharedTargetId, position: [3.5, 34, 0.5] });
  const created = server.character({ kind: 'create', profile, position: [1.5, 34, 0.5] });
  if (created.kind !== 'created') throw new Error('Character was not created.');
  server.registerPoi({ id: sharedTargetId, kind: 'camp', position: [2.5, 34, 1.5], label: 'Nearby camp' });
  const observed = server.character({ kind: 'observe', entityId: created.character.entityId });
  if (observed.kind !== 'observation') throw new Error('Character observation unavailable.');
  const target = observed.observation.visibleEntities.find((entry) => entry.type === 'player')?.target;
  if (!target || target.kind !== 'entity') throw new Error('Visible entity target unavailable.');
  expect(observed.observation.visiblePois).toContainEqual(
    expect.objectContaining({ target: expect.objectContaining({ kind: 'poi' }) }),
  );
  return { server, entityId: created.character.entityId, target, cursor: observed.observation.cursor };
};

describe('character target namespaces', () => {
  it('rejects a stale entity reference when only a same-id POI remains visible', () => {
    const { server, entityId, target, cursor } = setup();
    server.updateEntity(sharedTargetId, { position: [12.5, 34, 0.5] });
    const afterMove = server.character({ kind: 'observe', entityId });
    if (afterMove.kind !== 'observation') throw new Error('Character observation unavailable.');
    expect(afterMove.observation.visibleEntities.some((entry) => entry.target.ref === target.ref)).toBe(false);
    expect(afterMove.observation.visiblePois).toContainEqual(
      expect.objectContaining({ target: expect.objectContaining({ kind: 'poi' }) }),
    );
    const before = server.character({ kind: 'inspect', entityId });

    expect(() =>
      server.character({
        kind: 'intent',
        entityId,
        requestId: 'follow-stale-entity',
        expectedRevision: 0,
        expectedCursor: cursor,
        goal: { kind: 'follow', target },
      }),
    ).toThrow(/CHARACTER_TARGET_UNAVAILABLE/);
    expect(server.character({ kind: 'inspect', entityId })).toEqual(before);
  });

  it('ends an ongoing follow when the entity leaves visibility but a same-id POI remains', () => {
    const { server, entityId, target, cursor } = setup();
    expect(
      server.character({
        kind: 'intent',
        entityId,
        requestId: 'follow-visible-entity',
        expectedRevision: 0,
        expectedCursor: cursor,
        goal: { kind: 'follow', target },
      }),
    ).toMatchObject({ kind: 'intent', accepted: true });
    expect(server.getActorAction(entityId)).toMatchObject({
      targetEntityId: sharedTargetId,
      targetPosition: [3.5, 34, 0.5],
    });

    server.updateEntity(sharedTargetId, { position: [12.5, 34, 0.5] });
    server.advanceGameplayRules(0.1);

    expect(server.character({ kind: 'inspect', entityId })).toMatchObject({
      kind: 'state',
      character: {
        currentGoal: { goal: { kind: 'follow' }, status: 'failed', reason: 'target-unavailable' },
      },
    });
    expect(server.getActorAction(entityId)).toBeNull();
  });

  it('rejects POI references as follow goals without mutating the character', () => {
    const { server, entityId } = setup();
    const observed = server.character({ kind: 'observe', entityId });
    if (observed.kind !== 'observation') throw new Error('Character observation unavailable.');
    const poi = observed.observation.visiblePois[0]?.target;
    if (!poi) throw new Error('Visible POI target unavailable.');
    const before = server.character({ kind: 'inspect', entityId });

    expect(() =>
      server.character({
        kind: 'intent',
        entityId,
        requestId: 'follow-poi',
        expectedRevision: 0,
        expectedCursor: observed.observation.cursor,
        goal: { kind: 'follow', target: poi },
      }),
    ).toThrow(/Character follow target is invalid/);
    expect(server.character({ kind: 'inspect', entityId })).toEqual(before);
  });
});
