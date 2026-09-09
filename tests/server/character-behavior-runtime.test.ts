import { describe, expect, it } from 'vitest';
import { createLifeBehavior } from '../../packages/game-core/src/runtime/character-control-protocol';
import { GameServer } from '../../packages/game-core/src/server/game-server';
import { MemoryGamePersistence } from '../../packages/game-core/src/server/persistence/memory-game-persistence';
import { testCorePlatform } from '../support/core-platform';

const profile = { name: 'Lin', personality: 'Patient and practical.', riskTolerance: 0.25 } as const;

describe('world-owned character behavior', () => {
  it('creates and atomically replaces a validated behavior tree', () => {
    const server = new GameServer({ platform: testCorePlatform, seedText: 'behavior-control' });
    server.spawnPlayer({ id: 'player', position: [0.5, 34, 0.5] });
    const behaviorTree = createLifeBehavior({
      homePosition: [1.5, 34, 0.5],
      patrolPositions: [
        [2.5, 34, 0.5],
        [1.5, 34, 1.5],
      ],
    });
    const created = server.character({
      kind: 'create',
      profile,
      position: [1.5, 34, 0.5],
      behaviorTree,
    });
    if (created.kind !== 'created') throw new Error('Character was not created.');
    expect(created.character.behaviorTree).toMatchObject({ revision: 1, goal: behaviorTree.goal });
    expect(server.character({ kind: 'capabilities' })).toMatchObject({
      kind: 'capabilities',
      capabilities: expect.arrayContaining([
        expect.objectContaining({ name: 'satisfy-hunger', kind: 'skill' }),
        expect.objectContaining({ name: 'hunger-at-least', kind: 'condition' }),
      ]),
    });

    const replacement = createLifeBehavior({
      homePosition: [1.5, 34, 0.5],
      patrolPositions: [[3.5, 34, 0.5]],
      threatResponse: 'ignore',
    });
    expect(
      server.character({
        kind: 'behavior',
        entityId: created.character.entityId,
        requestId: 'replace-life',
        expectedBehaviorRevision: 1,
        ...replacement,
      }),
    ).toMatchObject({ kind: 'behavior', accepted: true, character: { behaviorTree: { revision: 2 } } });
    const before = server.character({ kind: 'inspect', entityId: created.character.entityId });
    expect(() =>
      server.character({
        kind: 'behavior',
        entityId: created.character.entityId,
        requestId: 'stale-life',
        expectedBehaviorRevision: 1,
        ...behaviorTree,
      }),
    ).toThrow(/CHARACTER_BEHAVIOR_CONFLICT/);
    expect(server.character({ kind: 'inspect', entityId: created.character.entityId })).toEqual(before);
  });

  it('rebuilds public tree state from its ledger without replaying completed speech', async () => {
    const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
    const source = new GameServer({ platform: testCorePlatform, seedText: 'behavior-ledger', persistence });
    source.spawnPlayer({ id: 'player', position: [0.5, 34, 0.5] });
    const created = source.character({
      kind: 'create',
      profile,
      position: [1.5, 34, 0.5],
      behaviorTree: {
        goal: { description: 'Greet once, then wait.' },
        definition: {
          version: 1,
          root: {
            id: 'greeting',
            type: 'sequence',
            children: [
              { id: 'say-once', type: 'action', skill: 'speak', args: { text: 'Hello.' } },
              { id: 'wait-after', type: 'action', skill: 'hold' },
            ],
          },
        },
      },
    });
    if (created.kind !== 'created') throw new Error('Character was not created.');
    source.advanceGameplayRules(0.1);
    const clean = testCorePlatform.clone(source.freezePortableSaveSnapshot(1));
    expect(
      clean.gameplay.simulation.characters?.characters[0]?.events.filter((event) => event.type === 'speech'),
    ).toHaveLength(1);
    const before = source.character({ kind: 'inspect', entityId: created.character.entityId });
    const corrupt = testCorePlatform.clone(clean);
    const execution = corrupt.gameplay.simulation.characters?.characters[0]?.behaviorTree?.skills[0];
    if (!execution) throw new Error('Behavior execution snapshot unavailable.');
    (execution as { signature: string }).signature = 'corrupt';
    persistence.saveFrozenSnapshot(corrupt);
    await expect(source.restore()).rejects.toThrow(/Invalid gameplay snapshot/);
    expect(source.character({ kind: 'inspect', entityId: created.character.entityId })).toEqual(before);

    persistence.saveFrozenSnapshot(clean);
    const restored = new GameServer({ platform: testCorePlatform, seedText: 'behavior-ledger', persistence });
    await restored.restore();
    restored.advanceGameplayRules(0.1);
    const observed = restored.character({ kind: 'observe', entityId: created.character.entityId, sinceCursor: 0 });
    if (observed.kind !== 'observation') throw new Error('Observation unavailable.');
    expect(
      observed.observation.events.filter((event) => event.type === 'speech' && event.text === 'Hello.'),
    ).toHaveLength(1);
  });
});
