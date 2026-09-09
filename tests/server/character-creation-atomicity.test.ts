import { expect, it } from 'vitest';
import { GameServer } from '../../packages/game-core/src/server/game-server';
import { MAX_RETAINED_ACTORS } from '../../packages/game-core/src/server/simulation/actor-state';
import { testCorePlatform } from '../support/core-platform';

it('rolls back the spawned entity when the real autonomous actor capacity rejects registration', () => {
  const server = new GameServer({ platform: testCorePlatform, seedText: 'character-creation-capacity' });
  for (let index = 0; index < MAX_RETAINED_ACTORS; index += 1)
    server.spawnAutonomousActor({ id: `actor-${index}`, archetype: 'settler', position: [index, 34, 0.5] });

  const entityCount = server.queryEntities({ type: 'npc' }).length;
  const actorCount = server.simulationSnapshot().actors.length;
  const revision = server.gameplayRevision;
  expect(() => server.spawnAutonomousActor({ id: 'overflow', archetype: 'settler', position: [513, 34, 0.5] })).toThrow(
    /Autonomous actor limit reached/,
  );

  expect(server.getEntity('overflow')).toBeNull();
  expect(server.queryEntities({ type: 'npc' })).toHaveLength(entityCount);
  expect(server.simulationSnapshot().actors).toHaveLength(actorCount);
  expect(server.gameplayRevision).toBe(revision);
  expect(server.getActorState('actor-0')).toMatchObject({ entityId: 'actor-0', archetype: 'settler' });
  expect(server.getActorState(`actor-${MAX_RETAINED_ACTORS - 1}`)).toMatchObject({
    entityId: `actor-${MAX_RETAINED_ACTORS - 1}`,
    archetype: 'settler',
  });

  const characterCount = server.character({ kind: 'list' });
  for (let attempt = 0; attempt < 2; attempt += 1)
    expect(() =>
      server.character({
        kind: 'create',
        profile: { name: `Overflow ${attempt}`, personality: 'Patient.', riskTolerance: 0.5 },
        position: [2 + attempt, 34, 2],
      }),
    ).toThrow(/Autonomous actor limit reached/);
  expect(server.queryEntities({ type: 'npc' })).toHaveLength(entityCount);
  expect(server.simulationSnapshot().actors).toHaveLength(actorCount);
  expect(server.character({ kind: 'list' })).toEqual(characterCount);
  expect(server.gameplayRevision).toBe(revision);
});
