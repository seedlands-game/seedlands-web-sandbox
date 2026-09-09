import { expect, it } from 'vitest';
import { GameServer } from '../../packages/game-core/src/server/game-server';
import { MemoryGamePersistence } from '../../packages/game-core/src/server/persistence/memory-game-persistence';
import { testCorePlatform } from '../support/core-platform';

it('retains the visible follow reference when a new attacker fills an already full target table', () => {
  const server = new GameServer({ platform: testCorePlatform, seedText: 'character-target-retention' });
  server.spawnPlayer({ id: 'player', position: [0.5, 34.6, 0.5] });
  const created = server.character({
    kind: 'create',
    profile: {
      name: 'Lin',
      personality: 'Cautious',
      background: 'Traveler',
      riskTolerance: 0.25,
    },
    position: [2, 34.6, 0.5],
  });
  if (created.kind !== 'created') throw new Error('Character unavailable.');
  const entityId = created.character.entityId;
  const observed = server.character({ kind: 'observe', entityId });
  if (observed.kind !== 'observation') throw new Error('Observation unavailable.');
  const target = observed.observation.visibleEntities.find((entry) => entry.type === 'player')?.target;
  if (!target) throw new Error('Player target unavailable.');
  server.character({
    kind: 'intent',
    entityId,
    requestId: 'follow',
    expectedRevision: 0,
    goal: { kind: 'follow', target },
  });
  for (let index = 0; index < 128; index += 1) {
    const id = `temporary-${index}`;
    server.spawnAutonomousActor({ id, archetype: 'settler', position: [3, 34.6, 0.5] });
    server.character({ kind: 'observe', entityId });
    server.despawnEntity(id);
  }
  expect(server.simulationSnapshot().characters?.characters[0]?.targets).toHaveLength(128);
  server.spawnPlayer({ id: 'attacker', position: [2, 34.6, 1.5] });
  expect(server.attackEntity('attacker', entityId)).toMatchObject({ success: true, damage: 4 });
  // Inspect does not regenerate references: retry the exact reference issued before the attack.
  const state = server.character({ kind: 'inspect', entityId });
  if (state.kind !== 'state') throw new Error('Character state unavailable.');
  expect(
    server.character({
      kind: 'intent',
      entityId,
      requestId: 'follow-after-danger',
      expectedRevision: state.character.revision,
      goal: { kind: 'follow', target },
    }),
  ).toMatchObject({ kind: 'intent', accepted: true });
  expect(server.simulationSnapshot().characters?.characters[0]?.targets).toHaveLength(128);
});

it('atomically rejects a checkpoint with no target reference sequence headroom before later combat', async () => {
  const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
  const server = new GameServer({ platform: testCorePlatform, seedText: 'target-sequence-headroom', persistence });
  server.spawnPlayer({ id: 'player', position: [0.5, 34.6, 0.5] });
  const created = server.character({
    kind: 'create',
    profile: { name: 'Lin', personality: 'Cautious', riskTolerance: 0.25 },
    position: [2, 34.6, 0.5],
  });
  if (created.kind !== 'created') throw new Error('Character unavailable');
  const entityId = created.character.entityId;
  server.character({ kind: 'observe', entityId });
  const before = server.freezeSaveSnapshot(1);
  const corrupt = testCorePlatform.clone(before);
  const record = corrupt.gameplay.simulation.characters!.characters[0]!;
  expect(record.targets).toHaveLength(1);
  Object.assign(record.targets[0]!, { ref: `target-${Number.MAX_SAFE_INTEGER}` });
  Object.assign(record, { targetSequence: Number.MAX_SAFE_INTEGER });
  persistence.saveFrozenSnapshot(corrupt);
  await expect(server.restore()).rejects.toThrow(/target sequence/);
  expect(server.freezeSaveSnapshot(1)).toEqual(before);
  const missingTail = testCorePlatform.clone(before);
  Object.assign(missingTail.gameplay.simulation.characters!.characters[0]!, { eventCursor: 1, events: [] });
  persistence.saveFrozenSnapshot(missingTail);
  await expect(server.restore()).rejects.toThrow(/snapshot state/);
  expect(server.freezeSaveSnapshot(1)).toEqual(before);
  server.spawnPlayer({ id: 'attacker', position: [2, 34.6, 1.5] });
  expect(server.attackEntity('attacker', entityId)).toMatchObject({ success: true, damage: 4 });
  const afterAttack = server.character({ kind: 'observe', entityId, sinceCursor: 0 });
  expect(afterAttack).toMatchObject({
    kind: 'observation',
    observation: { events: expect.arrayContaining([expect.objectContaining({ type: 'attacked' })]) },
  });
  if (afterAttack.kind !== 'observation') throw new Error('Character observation unavailable.');
  expect(afterAttack.observation.character.behaviorTree).toEqual(created.character.behaviorTree);
});

it.each([
  'eventCursor',
  'revision',
  'policyRevision',
  'memoryRevision',
  'zeroEvent',
  'sequence',
  'negativeSequence',
] as const)('atomically rejects invalid character counter %s and preserves later dialogue', async (counter) => {
  const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
  const server = new GameServer({ platform: testCorePlatform, seedText: 'character-counter-headroom', persistence });
  const created = server.character({
    kind: 'create',
    profile: { name: 'Lin', personality: 'Cautious' },
    position: [2, 34.6, 0.5],
  });
  if (created.kind !== 'created') throw new Error('Character unavailable');
  const entityId = created.character.entityId;
  const before = server.freezeSaveSnapshot(1);
  const corrupt = testCorePlatform.clone(before);
  const record = corrupt.gameplay.simulation.characters!.characters[0]!;
  if (counter === 'sequence' || counter === 'negativeSequence')
    Object.assign(corrupt.gameplay.simulation.characters!, {
      sequence: counter === 'sequence' ? Number.MAX_SAFE_INTEGER : -1,
    });
  else if (counter === 'memoryRevision') Object.assign(record.memory, { revision: Number.MAX_SAFE_INTEGER });
  else if (counter === 'zeroEvent' || counter === 'eventCursor') {
    const cursor = counter === 'zeroEvent' ? 0 : Number.MAX_SAFE_INTEGER;
    Object.assign(record, {
      eventCursor: cursor,
      events: [{ cursor, at: 0, type: 'dialogue-heard', text: 'Hello' }],
    });
  } else Object.assign(record, { [counter]: Number.MAX_SAFE_INTEGER });
  persistence.saveFrozenSnapshot(corrupt);
  await expect(server.restore(), counter).rejects.toThrow(/snapshot/);
  expect(server.freezeSaveSnapshot(1), counter).toEqual(before);
  server.character({ kind: 'dialogue', entityId, text: 'Hello again' });
  expect(server.character({ kind: 'observe', entityId, sinceCursor: 0 })).toMatchObject({
    kind: 'observation',
    observation: { cursor: 1, events: [{ cursor: 1, text: 'Hello again' }] },
  });
  const after = server.freezeSaveSnapshot(2);
  persistence.saveFrozenSnapshot(after);
  await server.restore();
  expect(server.freezeSaveSnapshot(2)).toEqual(after);
});
