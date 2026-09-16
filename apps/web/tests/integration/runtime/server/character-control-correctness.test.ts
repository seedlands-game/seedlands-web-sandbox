import { describe, expect, it } from 'vitest';
import type { GameServer } from '../../../../../../packages/stdlib/src/server/game-server';
import { MemoryGamePersistence } from '../../../../../../packages/stdlib/src/server/persistence/memory-game-persistence';
import { behaviorActionSignature } from '../../../../../../packages/stdlib/src/server/simulation/character-behavior-definition';
import { Voxel } from '../../../../../../packages/stdlib/src/world/voxel';
import { testCorePlatform } from '../../../../../../packages/stdlib/tests/support/core-platform';
import { characterActorSnapshot, createCharacterServer } from '../../../fixtures/classic/character-gameplay';

const profile = { name: 'Lin', personality: 'Cautious, practical, and kind.', riskTolerance: 0.25 } as const;

const surfaceY = (server: GameServer, x: number, z: number): number => {
  for (let y = 80; y > 0; y -= 1)
    if (
      server.getVoxel(Math.floor(x), y - 1, Math.floor(z)) !== Voxel.Air &&
      server.getVoxel(Math.floor(x), y, Math.floor(z)) === Voxel.Air &&
      server.getVoxel(Math.floor(x), y + 1, Math.floor(z)) === Voxel.Air
    )
      return y;
  throw new Error('Walkable test surface is unavailable.');
};

describe('character control correctness', () => {
  it('rejects an intent observed before newer dialogue without mutating the character', () => {
    const server = createCharacterServer({ platform: testCorePlatform, seedText: 'character-stale-cursor' });
    server.spawnPlayer({ id: 'player', position: [0.5, 34, 0.5] });
    const created = server.character({ kind: 'create', profile, position: [1.5, 34, 0.5] });
    if (created.kind !== 'created') throw new Error('Character was not created.');
    const entityId = created.character.entityId;
    const observed = server.character({ kind: 'observe', entityId });
    if (observed.kind !== 'observation') throw new Error('Character observation unavailable.');
    server.character({ kind: 'dialogue', entityId, text: 'This arrived during the decision.' });

    expect(() =>
      server.character({
        kind: 'intent',
        entityId,
        requestId: 'stale-decision',
        expectedRevision: 0,
        expectedCursor: observed.observation.cursor,
        goal: { kind: 'idle' },
        say: 'I missed the new dialogue.',
      }),
    ).toThrow(/CHARACTER_REVISION_CONFLICT/);
    expect(server.character({ kind: 'inspect', entityId })).toMatchObject({
      kind: 'state',
      character: { revision: 0, currentGoal: { goal: { kind: 'forage' } } },
    });

    expect(
      server.character({
        kind: 'intent',
        entityId,
        requestId: 'fresh-decision',
        expectedRevision: 0,
        expectedCursor: 1,
        goal: { kind: 'idle' },
        say: 'I heard you.',
      }),
    ).toMatchObject({ kind: 'intent', character: { revision: 1 } });
    server.character({ kind: 'dialogue', entityId, text: 'A later message.' });
    expect(
      server.character({
        kind: 'intent',
        entityId,
        requestId: 'fresh-decision',
        expectedRevision: 0,
        expectedCursor: 1,
        goal: { kind: 'idle' },
        say: 'I heard you.',
      }),
    ).toMatchObject({ kind: 'intent', character: { revision: 1 } });
  });

  it('atomically rejects missing, foreign and tree-mismatched character action links', async () => {
    const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
    const server = createCharacterServer({
      platform: testCorePlatform,
      seedText: 'character-action-link',
      persistence,
    });
    const startY = surfaceY(server, 2.5, 0.5);
    const targetPosition: [number, number, number] = [6.5, surfaceY(server, 6.5, 0.5), 0.5];
    server.spawnPlayer({ id: 'player', position: [0.5, surfaceY(server, 0.5, 0.5), 0.5] });
    const created = server.character({
      kind: 'create',
      profile,
      position: [2.5, startY, 0.5],
      behaviorTree: {
        goal: { description: 'Move to the destination.' },
        definition: {
          version: 1,
          root: { id: 'move-character', type: 'action', skill: 'move-to', args: { position: targetPosition } },
        },
      },
    });
    if (created.kind !== 'created') throw new Error('Character was not created.');
    const entityId = created.character.entityId;
    server.advanceGameplayRules(0.5);
    const started = server.getActorAction(entityId);
    if (!started) throw new Error('Character movement action is unavailable.');
    const linked = testCorePlatform.clone(server.freezeSaveSnapshot());
    const linkedBehavior = characterActorSnapshot(linked.gameplay, entityId)?.character?.behaviorTree;
    if (!linkedBehavior || linkedBehavior.definition.root.type !== 'action')
      throw new Error('Character behavior is unavailable.');
    const linkedActionId = started.id;
    persistence.saveFrozenSnapshot(linked);
    await expect(server.restore()).resolves.toBeUndefined();
    const originalAction = server.getActorAction(entityId);
    if (!originalAction) throw new Error('Character action is unavailable.');
    server.spawnAutonomousActor({ id: 'foreign', archetype: 'settler', position: [4.5, 34, 0.5] });
    const foreignAction = server.startActorAction('foreign', { type: 'move-to', targetPosition });
    const beforeCharacter = server.character({ kind: 'inspect', entityId });

    const reject = async (mutate: (snapshot: ReturnType<GameServer['freezeSaveSnapshot']>) => void) => {
      const corrupt = testCorePlatform.clone(server.freezeSaveSnapshot());
      mutate(corrupt);
      persistence.saveFrozenSnapshot(corrupt);
      await expect(server.restore()).rejects.toThrow(/Invalid gameplay snapshot/);
      expect(server.character({ kind: 'inspect', entityId })).toEqual(beforeCharacter);
      expect(server.getActorAction(entityId)).toEqual(originalAction);
      expect(server.getActorAction('foreign')).toEqual(foreignAction);
    };
    await reject((snapshot) => {
      const execution = characterActorSnapshot(snapshot.gameplay, entityId)?.character?.behaviorTree.skills[0];
      if (!execution) throw new Error('Character behavior execution is unavailable.');
      execution.actionId = 'action-missing';
    });
    await reject((snapshot) => {
      const execution = characterActorSnapshot(snapshot.gameplay, entityId)?.character?.behaviorTree.skills[0];
      if (!execution) throw new Error('Character behavior execution is unavailable.');
      execution.actionId = foreignAction.id;
    });
    await reject((snapshot) => {
      const action = snapshot.gameplay.simulation.actions.actions.find((candidate) => candidate.id === linkedActionId);
      if (!action) throw new Error('Snapshot action is unavailable.');
      action.type = 'wander';
    });

    const terminal = testCorePlatform.clone(server.freezeSaveSnapshot());
    const terminalAction = terminal.gameplay.simulation.actions.actions.find(
      (candidate) => candidate.id === linkedActionId,
    );
    if (!terminalAction) throw new Error('Snapshot action is unavailable.');
    terminalAction.status = 'succeeded';
    terminalAction.endedAt = terminal.gameplay.simulation.time;
    persistence.saveFrozenSnapshot(terminal);
    await expect(server.restore()).resolves.toBeUndefined();
    server.advanceGameplayRules(0.1);
    const resumed = characterActorSnapshot(server.freezeSaveSnapshot().gameplay, entityId)?.character?.behaviorTree
      .skills[0];
    expect(resumed?.actionId).not.toBe(linkedActionId);
  });

  it('atomically rejects inconsistent running and interrupted follow execution targets', async () => {
    const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
    const server = createCharacterServer({
      platform: testCorePlatform,
      seedText: 'character-follow-link',
      persistence,
    });
    server.spawnPlayer({ id: 'player', position: [0.5, 34.6, 0.5] });
    const created = server.character({ kind: 'create', profile, position: [4.5, 34.6, 0.5] });
    if (created.kind !== 'created') throw new Error('Character was not created.');
    const entityId = created.character.entityId;
    const observed = server.character({ kind: 'observe', entityId });
    if (observed.kind !== 'observation') throw new Error('Character observation unavailable.');
    const target = observed.observation.visibleEntities.find((entry) => entry.type === 'player')?.target;
    if (!target) throw new Error('Player target is unavailable.');
    server.character({
      kind: 'behavior',
      entityId,
      requestId: 'nearby-follow',
      expectedBehaviorRevision: 1,
      goal: { description: 'Follow the visible player and flee when threatened.' },
      definition: {
        version: 1,
        root: {
          id: 'safe-follow',
          type: 'selector',
          children: [
            {
              id: 'flee',
              type: 'action',
              skill: 'flee-threat',
              guard: { name: 'threat-visible' },
            },
            {
              id: 'follow-player',
              type: 'action',
              skill: 'follow',
              args: { targetRef: target.ref },
              guard: { not: { name: 'threat-visible' } },
            },
          ],
        },
      },
    });
    const seeded = testCorePlatform.clone(server.freezeSaveSnapshot());
    const followBehavior = characterActorSnapshot(seeded.gameplay, entityId)?.character?.behaviorTree;
    const followNode =
      followBehavior?.definition.root.type === 'selector' ? followBehavior.definition.root.children[1] : null;
    if (!followBehavior || !followNode || followNode.type !== 'action')
      throw new Error('Follow behavior is unavailable.');
    followBehavior.activationSequence = 1;
    followBehavior.skills = [
      {
        nodeId: followNode.id,
        skill: followNode.skill,
        signature: behaviorActionSignature(followNode),
        activation: 1,
        status: 'running',
        phase: 'following',
        elapsedSeconds: 0,
        replanCount: 0,
        targetEntityId: 'player',
        count: 0,
      },
    ];
    persistence.saveFrozenSnapshot(seeded);
    await expect(server.restore()).resolves.toBeUndefined();
    const followExecution = server.freezeSaveSnapshot().gameplay;
    const restoredFollow = characterActorSnapshot(followExecution, entityId)?.character?.behaviorTree.skills.find(
      (entry) => entry.nodeId === 'follow-player',
    );
    expect(restoredFollow).toMatchObject({ status: 'running', targetEntityId: 'player' });
    expect(restoredFollow?.actionId).toBeUndefined();
    await server.save();

    const rejectExecutionMismatch = async () => {
      const before = server.character({ kind: 'inspect', entityId });
      const corrupt = testCorePlatform.clone(server.freezeSaveSnapshot());
      const execution = characterActorSnapshot(corrupt.gameplay, entityId)?.character?.behaviorTree.skills.find(
        (entry) => entry.nodeId === 'follow-player',
      );
      if (!execution) throw new Error('Follow execution is unavailable.');
      execution.targetEntityId = 'different-target';
      persistence.saveFrozenSnapshot(corrupt);
      await expect(server.restore()).rejects.toThrow(/Invalid gameplay snapshot/);
      expect(server.character({ kind: 'inspect', entityId })).toEqual(before);
    };
    await rejectExecutionMismatch();

    server.spawnPlayer({ id: 'attacker', position: [4.5, 34.6, 1.5] });
    expect(server.attackEntity('attacker', entityId)).toMatchObject({ success: true, damage: 4 });
    server.advanceGameplayRules(0.1);
    await server.save();
    await expect(server.restore()).resolves.toBeUndefined();
    const suspendedFollow = characterActorSnapshot(server.freezeSaveSnapshot().gameplay, entityId)?.character;
    expect(suspendedFollow?.behaviorTree.skills.find((entry) => entry.nodeId === 'follow-player')).toMatchObject({
      status: 'interrupted',
      targetEntityId: 'player',
    });
    expect(suspendedFollow?.behaviorTree.skills.find((entry) => entry.nodeId === 'flee')).toMatchObject({
      status: 'running',
    });
    await rejectExecutionMismatch();
  });
});
