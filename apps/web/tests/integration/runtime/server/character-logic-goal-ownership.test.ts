import { describe, expect, it } from 'vitest';
import { AuthorityRuntime } from '../../../../../../packages/stdlib/src/server/authority/authority-runtime';
import { HeadlessSession } from '../../../../../../packages/stdlib/src/server/headless/headless-session';
import { decideLogicIntents } from '../../../../../../packages/stdlib/src/server/logic/logic-decision';
import { MemoryGamePersistence } from '../../../../../../packages/stdlib/src/server/persistence/memory-game-persistence';
import type { FrozenGameSaveSnapshot } from '../../../../../../packages/stdlib/src/server/persistence/game-save-snapshot';
import { Voxel, voxelIndex } from '../../../../../../packages/stdlib/src/world/voxel';
import { testCorePlatform } from '../../../../../../packages/stdlib/tests/support/core-platform';
import { createCharacterComposition } from '../../../fixtures/classic/character-gameplay';
import {
  createGameplayActorAuthority,
  createGameplaySystemAuthority,
  worldgenProviderForComposition,
} from '@seedlands/stdlib/host';

const profile = {
  name: 'Lin',
  personality: 'Patient and observant.',
  riskTolerance: 0.25,
} as const;

const horizontal = (position: readonly number[] | undefined) => position && [position[0], position[2]];

async function createFlatAuthority(
  seedText: string,
  persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone }),
) {
  let runtime: AuthorityRuntime | null = null;
  const logic: Array<{ accepted: boolean; intents: unknown }> = [];
  const composition = createCharacterComposition();
  const created = await AuthorityRuntime.create({
    platform: testCorePlatform,
    composition,
    worldgenProvider: worldgenProviderForComposition(composition),
    moduleActorAuthority: createGameplayActorAuthority(composition.resources, { playerAlias: 'test-player' }),
    moduleSystemAuthority: createGameplaySystemAuthority(composition),
    epoch: `logic:${seedText}`,
    seedText,
    persistence,
    initialWorldTime: 9,
    startTimeMs: 0,
    initialPlayerBodyPosition: [0.5, 1, 0.5],
    onLogicObservation: (observation) => {
      if (!runtime) throw new Error('Logic callback ran before Authority initialization.');
      const batch = decideLogicIntents(observation, { physicsHz: 60 });
      logic.push({ accepted: runtime.receiveLogicIntentBatch(batch), intents: batch.intents });
      runtime.requestLogicObservation();
    },
  });
  runtime = created;
  const prepared = await runtime.prepareMesh(0, 0, 0);
  const canonical = new Uint16Array(32 ** 3);
  for (let z = 0; z < 32; z += 1) for (let x = 0; x < 32; x += 1) canonical[voxelIndex(x, 0, z)] = Voxel.Stone;
  if (prepared.canonical === undefined && !runtime.acceptGeneratedChunk({ ...prepared, canonical }))
    throw new Error('Flat chunk was rejected.');
  runtime.requestLogicObservation();
  return { runtime, persistence, logic };
}

async function createCharacter(session: HeadlessSession, offset: number) {
  await session.world.clock({ kind: 'pause' });
  const player = session.runtime.server.getEntity(session.runtime.playerId);
  if (!player) throw new Error('Player is unavailable.');
  const created = await session.world.character({
    kind: 'create',
    profile,
    position: [player.position[0] + offset, player.position[1], player.position[2]],
  });
  if (!created.ok || created.data.kind !== 'created') throw new Error('Character was not created.');
  return { player, character: created.data.character };
}

describe('persistent character goal ownership in Logic', () => {
  it('keeps an explicit idle character still without assigning ownership to an ordinary settler', async () => {
    const session = await HeadlessSession.create({
      platform: testCorePlatform,
      seedText: 'logic-character-idle',
      createComposition: createCharacterComposition,
    });
    const { player, character } = await createCharacter(session, 2);
    const ordinary = session.runtime.server.spawnAutonomousActor({
      id: 'ordinary-settler',
      archetype: 'settler',
      position: [player.position[0] + 5, player.position[1], player.position[2]],
    });
    expect(
      await session.world.character({
        kind: 'intent',
        entityId: character.entityId,
        requestId: 'wait-here',
        expectedRevision: character.revision,
        goal: { kind: 'idle' },
      }),
    ).toMatchObject({ ok: true });
    await session.world.clock({ kind: 'advance', elapsedMs: 500 });
    const characterBefore = horizontal(session.runtime.server.getEntity(character.entityId)?.position);

    await session.world.clock({ kind: 'advance', elapsedMs: 4_000 });

    expect(horizontal(session.runtime.server.getEntity(character.entityId)?.position)).toEqual(characterBefore);
    expect(session.runtime.server.getActorAction(character.entityId)).toBeNull();
    const projected = session.runtime.createLogicObservation().decisionContext.actors;
    expect(projected.find((entry) => entry.state.entityId === character.entityId)).toMatchObject({
      controlSource: 'behavior',
    });
    expect(session.runtime.character({ kind: 'inspect', entityId: character.entityId })).toMatchObject({
      character: { currentGoal: { goal: { kind: 'idle' }, status: 'active' } },
    });
    expect(projected.find((entry) => entry.state.entityId === ordinary.id)?.controlSource).toBe('autonomous');
    expect(projected.find((entry) => entry.state.entityId === ordinary.id)?.state).not.toHaveProperty('persistentGoal');
    await session.dispose();
  }, 30_000);

  it('holds an arrived follow goal and reacquires movement only after its target moves', async () => {
    const { runtime, logic } = await createFlatAuthority('logic-character-follow');
    const created = runtime.character({ kind: 'create', profile, position: [1.9, 1, 0.5] });
    if (created.kind !== 'created') throw new Error('Character was not created.');
    const character = created.character;
    const observed = runtime.character({ kind: 'observe', entityId: character.entityId });
    if (observed.kind !== 'observation') throw new Error('Observation is unavailable.');
    const target = observed.observation.visibleEntities.find((entity) => entity.type === 'player')?.target;
    if (!target) throw new Error('Player target is unavailable.');
    expect(
      runtime.character({
        kind: 'intent',
        entityId: character.entityId,
        requestId: 'stay-close',
        expectedRevision: character.revision,
        goal: { kind: 'follow', target },
      }),
    ).toMatchObject({ kind: 'intent', accepted: true });
    runtime.advanceSession(500);
    expect(runtime.server.getActorAction(character.entityId)).toBeNull();
    const arrived = runtime.server.getEntity(character.entityId)?.position;
    runtime.advanceSession(4_000);
    expect(horizontal(runtime.server.getEntity(character.entityId)?.position)).toEqual(horizontal(arrived));
    runtime.setPlayerPosition([5.5, 1, 0.5]);
    runtime.advanceSession(4_000);
    expect(runtime.server.getActorAction(character.entityId)).toMatchObject({
      type: 'move-to',
      targetEntityId: runtime.playerId,
      targetPosition: [5.5, 1, 0.5],
      status: 'running',
    });
    expect(logic.slice(-3)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accepted: true,
          intents: expect.arrayContaining([expect.objectContaining({ wish: { x: 1, z: 0 } })]),
        }),
      ]),
    );
    expect(runtime.character({ kind: 'inspect', entityId: character.entityId })).toMatchObject({
      kind: 'state',
      character: { currentGoal: { goal: { kind: 'follow' }, status: 'active' } },
    });
  }, 30_000);

  it('rebuilds goal ownership from Character state across old or forged checkpoint projections', async () => {
    const source = await createFlatAuthority('logic-character-save');
    const created = source.runtime.character({ kind: 'create', profile, position: [2.5, 1, 0.5] });
    if (created.kind !== 'created') throw new Error('Character was not created.');
    const character = created.character;
    source.runtime.character({
      kind: 'intent',
      entityId: character.entityId,
      requestId: 'saved-idle',
      expectedRevision: character.revision,
      goal: { kind: 'idle' },
    });
    source.runtime.advanceSession(1_000);
    const checkpoint = testCorePlatform.clone(source.runtime.exportPortableCheckpoint()) as FrozenGameSaveSnapshot;
    const actor = checkpoint.gameplay.simulation.actors.find((entry) => entry.entityId === character.entityId);
    if (!actor) throw new Error('Character actor is unavailable.');
    (actor as typeof actor & { persistentGoal?: unknown }).persistentGoal = { kind: 'forage', status: 'active' };

    source.persistence.saveFrozenSnapshot(checkpoint);
    const restored = await createFlatAuthority('logic-character-save', source.persistence);
    restored.runtime.advanceSession(500);
    const before = horizontal(restored.runtime.server.getEntity(character.entityId)?.position);
    restored.runtime.advanceSession(3_000);
    expect(horizontal(restored.runtime.server.getEntity(character.entityId)?.position)).toEqual(before);
    const projected = restored.runtime
      .createLogicObservation()
      .decisionContext.actors.find((entry) => entry.state.entityId === character.entityId);
    expect(projected?.controlSource).toBe('behavior');
    expect(projected?.state).not.toHaveProperty('persistentGoal');
    expect(restored.runtime.character({ kind: 'inspect', entityId: character.entityId })).toMatchObject({
      character: { currentGoal: { goal: { kind: 'idle' }, status: 'active' } },
    });
  }, 30_000);
});
