import { describe, expect, it } from 'vitest';
import { GameServer } from '../../packages/game-core/src/server/game-server';
import { MemoryGamePersistence } from '../../packages/game-core/src/server/persistence/memory-game-persistence';
import { testCorePlatform } from '../support/core-platform';

const profile = { name: 'Lin', personality: 'Cautious, practical, and kind.', riskTolerance: 0.25 } as const;

describe('character control correctness', () => {
  it('rejects an intent observed before newer dialogue without mutating the character', () => {
    const server = new GameServer({ platform: testCorePlatform, seedText: 'character-stale-cursor' });
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

  it('atomically rejects missing, foreign and goal-mismatched character action links', async () => {
    const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
    const server = new GameServer({ platform: testCorePlatform, seedText: 'character-action-link', persistence });
    server.spawnPlayer({ id: 'player', position: [0.5, 34, 0.5] });
    const created = server.character({ kind: 'create', profile, position: [2.5, 34, 0.5] });
    if (created.kind !== 'created') throw new Error('Character was not created.');
    const entityId = created.character.entityId;
    const targetPosition: [number, number, number] = [3.5, 34, 0.5];
    const started = server.startActorAction(entityId, { type: 'move-to', targetPosition });
    const linked = testCorePlatform.clone(server.freezeSaveSnapshot(9));
    const linkedRecord = linked.gameplay.simulation.characters?.characters[0] as {
      revision: number;
      currentGoal: {
        revision: number;
        requestId: string;
        goal: { kind: 'move-to'; position: readonly [number, number, number] };
        status: 'active';
      };
      actionId?: string;
    };
    linkedRecord.revision = 1;
    linkedRecord.currentGoal = {
      revision: 1,
      requestId: 'move-character',
      goal: { kind: 'move-to', position: targetPosition },
      status: 'active',
    };
    linkedRecord.actionId = started.id;
    persistence.saveFrozenSnapshot(linked);
    await expect(server.restore()).resolves.toBeUndefined();
    const originalAction = server.getActorAction(entityId);
    if (!originalAction) throw new Error('Character action is unavailable.');
    server.spawnAutonomousActor({ id: 'foreign', archetype: 'settler', position: [4.5, 34, 0.5] });
    const foreignAction = server.startActorAction('foreign', { type: 'move-to', targetPosition });
    const beforeCharacter = server.character({ kind: 'inspect', entityId });

    const reject = async (mutate: (snapshot: ReturnType<GameServer['freezeSaveSnapshot']>) => void) => {
      const corrupt = testCorePlatform.clone(server.freezeSaveSnapshot(10));
      mutate(corrupt);
      persistence.saveFrozenSnapshot(corrupt);
      await expect(server.restore()).rejects.toThrow(/Invalid gameplay snapshot/);
      expect(server.character({ kind: 'inspect', entityId })).toEqual(beforeCharacter);
      expect(server.getActorAction(entityId)).toEqual(originalAction);
      expect(server.getActorAction('foreign')).toEqual(foreignAction);
    };
    await reject((snapshot) => {
      const record = snapshot.gameplay.simulation.characters?.characters[0] as { actionId?: string };
      record.actionId = 'action-missing';
    });
    await reject((snapshot) => {
      const record = snapshot.gameplay.simulation.characters?.characters[0] as { actionId?: string };
      record.actionId = foreignAction.id;
    });
    await reject((snapshot) => {
      const action = snapshot.gameplay.simulation.actions.actions.find(
        (candidate) => candidate.id === originalAction.id,
      );
      if (!action) throw new Error('Snapshot action is unavailable.');
      action.type = 'wander';
    });

    const terminal = testCorePlatform.clone(server.freezeSaveSnapshot(11));
    const terminalAction = terminal.gameplay.simulation.actions.actions.find(
      (candidate) => candidate.id === originalAction.id,
    );
    if (!terminalAction) throw new Error('Snapshot action is unavailable.');
    terminalAction.status = 'succeeded';
    terminalAction.endedAt = terminal.gameplay.simulation.time;
    persistence.saveFrozenSnapshot(terminal);
    await expect(server.restore()).resolves.toBeUndefined();
    server.advanceGameplayRules(0.1);
    expect(server.freezeSaveSnapshot(12).gameplay.simulation.characters?.characters[0]?.actionId).toBeUndefined();
  });
});
