import { describe, expect, it } from 'vitest';
import { createCharacterServer } from '../../../fixtures/classic/character-gameplay';
import { MemoryGamePersistence } from '../../../../../../packages/stdlib/src/server/persistence/memory-game-persistence';
import { testCorePlatform } from '../../../../../../packages/stdlib/tests/support/core-platform';

const profile = { name: 'Lin', personality: 'Cautious and practical.', riskTolerance: 0.25 } as const;
const threatPolicy = (response: 'flee-threat' | 'ignore-threat') => ({
  goal: {
    description: response === 'flee-threat' ? 'Flee danger, otherwise hold.' : 'Observe danger without fleeing.',
  },
  definition: {
    version: 1 as const,
    root:
      response === 'flee-threat'
        ? {
            id: 'safety',
            type: 'selector' as const,
            children: [
              {
                id: 'respond-to-threat',
                type: 'action' as const,
                skill: 'flee-threat',
                guard: { name: 'threat-visible' },
              },
              {
                id: 'hold-position',
                type: 'action' as const,
                skill: 'hold',
                guard: { not: { name: 'threat-visible' } },
              },
            ],
          }
        : { id: 'observe-threat', type: 'action' as const, skill: 'ignore-threat' },
  },
});
const createServer = (
  seedText: string,
  response: 'flee-threat' | 'ignore-threat',
  persistence?: MemoryGamePersistence,
) => {
  const server = createCharacterServer({ platform: testCorePlatform, seedText, persistence });
  server.spawnPlayer({ id: 'player', position: [0.5, 34.6, 0.5] });
  const created = server.character({
    kind: 'create',
    profile,
    position: [1.5, 34.6, 0.5],
    behaviorTree: threatPolicy(response),
  });
  if (created.kind !== 'created') throw new Error('Character was not created.');
  return { server, entityId: created.character.entityId };
};

describe('tree-owned character danger response', () => {
  it('runs configured flee after repeated attacks and resumes the guarded fallback across persistence', async () => {
    const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
    const { server, entityId } = createServer('danger-flee-tree', 'flee-threat', persistence);
    server.advanceGameplayRules(0.1);
    expect(server.character({ kind: 'inspect', entityId })).toMatchObject({
      kind: 'state',
      character: { behaviorTree: { runtime: { activeNodeIds: ['hold-position'] } } },
    });
    expect(server.attackEntity('player', entityId)).toMatchObject({ success: true, damage: 4 });
    server.advanceGameplayRules(0.5);
    expect(server.character({ kind: 'inspect', entityId })).toMatchObject({
      kind: 'state',
      character: { behaviorTree: { runtime: { activeNodeIds: ['respond-to-threat'] } } },
    });
    const position = server.getEntity(entityId)?.position;
    if (!position) throw new Error('Character position is unavailable.');
    server.spawnPlayer({ id: 'second-attacker', position: [position[0], position[1], position[2] + 1] });
    expect(server.attackEntity('second-attacker', entityId)).toMatchObject({ success: true, damage: 4 });
    server.advanceGameplayRules(2.9);
    expect(server.character({ kind: 'inspect', entityId })).toMatchObject({
      kind: 'state',
      character: { behaviorTree: { runtime: { activeNodeIds: ['respond-to-threat'] } } },
    });
    await server.save();
    await expect(server.restore()).resolves.toBeUndefined();
    server.advanceGameplayRules(0.3);
    expect(server.character({ kind: 'observe', entityId, sinceCursor: 0 })).toMatchObject({
      kind: 'observation',
      observation: {
        character: { behaviorTree: { runtime: { activeNodeIds: ['hold-position'] } } },
        events: expect.arrayContaining([
          expect.objectContaining({ type: 'activity-interrupted', nodeId: 'respond-to-threat' }),
        ]),
      },
    });
  });

  it('keeps an explicit ignore policy and never injects a hidden flee action', () => {
    const { server, entityId } = createServer('danger-ignore-tree', 'ignore-threat');
    const before = server.character({ kind: 'inspect', entityId });
    expect(server.attackEntity('player', entityId)).toMatchObject({ success: true, damage: 4 });
    server.advanceGameplayRules(3.2);
    const after = server.character({ kind: 'observe', entityId, sinceCursor: 0 });
    expect(after).toMatchObject({
      kind: 'observation',
      observation: { events: expect.arrayContaining([expect.objectContaining({ type: 'attacked' })]) },
    });
    if (before.kind !== 'state' || after.kind !== 'observation') throw new Error('Character state unavailable.');
    expect(after.observation.character.behaviorTree.definition).toEqual(before.character.behaviorTree.definition);
    expect(
      server
        .simulationSnapshot()
        .actions.actions.filter((action) => action.actorId === entityId && action.type === 'flee'),
    ).toEqual([]);
  });
});
