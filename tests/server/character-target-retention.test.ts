import { expect, it } from 'vitest';
import { GameServer } from '../../packages/game-core/src/server/game-server';
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
