import { describe, expect, it } from 'vitest';
import { GameServer } from '../../packages/game-core/src/server/game-server';
import { MemoryGamePersistence } from '../../packages/game-core/src/server/persistence/memory-game-persistence';
import { testCorePlatform } from '../support/core-platform';
import { HeadlessSession } from '../../packages/game-core/src/server/headless/headless-session';
import { ItemIds } from '../../packages/game-core/src/server/gameplay/item-registry';

const profile = {
  name: 'Lin',
  personality: 'Cautious, practical, and kind.',
  background: 'A traveler learning this valley.',
  riskTolerance: 0.25,
} as const;

describe('character control runtime', () => {
  it('rejects malformed speech before changing the goal, revision or action state', () => {
    const server = new GameServer({ platform: testCorePlatform, seedText: 'character-state' });
    server.spawnPlayer({ id: 'player', position: [0.5, 34, 0.5] });
    const created = server.character({ kind: 'create', profile, position: [1.5, 34, 0.5] });
    if (created.kind !== 'created') throw new Error('Character was not created.');
    const before = testCorePlatform.clone(server.simulationSnapshot());
    for (const say of ['x'.repeat(281), 12]) {
      expect(() =>
        server.character({
          kind: 'intent',
          entityId: created.character.entityId,
          requestId: 'malformed-speech',
          expectedRevision: 0,
          goal: { kind: 'idle' },
          say: say as string,
        }),
      ).toThrow();
      expect(server.simulationSnapshot()).toEqual(before);
    }
  });

  it('creates, lists and observes a persistent character through bounded target references', async () => {
    const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
    const server = new GameServer({ platform: testCorePlatform, seedText: 'character-state', persistence });
    server.spawnPlayer({ id: 'player', position: [0.5, 34, 0.5] });
    const created = server.character({ kind: 'create', profile, position: [1.5, 34, 0.5] });
    expect(created).toMatchObject({
      kind: 'created',
      character: { profile, revision: 0, memory: { revision: 0, summary: '' }, inventory: expect.any(Array) },
    });
    if (created.kind !== 'created') throw new Error('Character was not created.');
    const entityId = created.character.entityId;
    server.spawnWorldItem([3.5, 34, 0.5], { itemId: 'berry', count: 2 });
    server.spawnAutonomousActor({ id: 'far', archetype: 'settler', position: [100.5, 34, 0.5] });

    expect(server.character({ kind: 'list' })).toMatchObject({
      kind: 'list',
      characters: [{ entityId, profile }],
    });
    const observed = server.character({ kind: 'observe', entityId });
    expect(observed).toMatchObject({ kind: 'observation', observation: { character: { entityId } } });
    if (observed.kind !== 'observation') throw new Error('Character observation unavailable.');
    expect(observed.observation.visibleEntities).toContainEqual(expect.objectContaining({ type: 'world-item' }));
    expect(observed.observation.visibleEntities.some((entry) => entry.position[0] > 90)).toBe(false);
    const food = observed.observation.visibleEntities.find((entry) => entry.stack?.itemId === 'berry');
    if (!food) throw new Error('Visible berry reference unavailable.');

    const following = server.character({
      kind: 'intent',
      entityId,
      requestId: 'follow-food',
      expectedRevision: 0,
      goal: { kind: 'follow', target: food.target },
    });
    expect(following).toMatchObject({ kind: 'intent', accepted: true });
    if (following.kind !== 'intent') throw new Error('Character intent unavailable.');
    expect(() =>
      server.character({
        kind: 'intent',
        entityId,
        requestId: 'forged-target',
        expectedRevision: following.character.revision,
        goal: { kind: 'follow', target: { kind: 'entity', ref: 'not-visible', revision: 1 } },
      }),
    ).toThrow(/CHARACTER_TARGET_UNAVAILABLE/);

    const dialogue = server.character({ kind: 'dialogue', entityId, text: 'Please bring food home.' });
    expect(dialogue).toMatchObject({ kind: 'dialogue', event: { type: 'dialogue-heard' } });
    const withEvents = server.character({ kind: 'observe', entityId, sinceCursor: 0 });
    if (withEvents.kind !== 'observation') throw new Error('Character observation unavailable.');
    const throughCursor = withEvents.observation.cursor;
    expect(
      server.character({
        kind: 'memory',
        entityId,
        expectedMemoryRevision: 0,
        throughCursor,
        summary: 'The player asked Lin to bring food home.',
      }),
    ).toMatchObject({ kind: 'memory', character: { memory: { revision: 1, throughCursor } } });

    await server.save();
    const restored = new GameServer({ platform: testCorePlatform, seedText: 'character-state', persistence });
    await restored.restore();
    expect(restored.character({ kind: 'inspect', entityId })).toMatchObject({
      kind: 'state',
      character: {
        entityId,
        incarnation: created.character.incarnation,
        profile,
        currentGoal: { goal: { kind: 'follow' } },
        memory: { revision: 1, throughCursor },
      },
    });
  });

  it('migrates an older simulation snapshot without character state', () => {
    const server = new GameServer({ platform: testCorePlatform, seedText: 'character-v1' });
    server.spawnPlayer({ id: 'player', position: [0.5, 34, 0.5] });
    expect(server.character({ kind: 'list' })).toEqual({ kind: 'list', characters: [] });
  });

  it('bounds references across many distinct observed and consumed targets', () => {
    const server = new GameServer({ platform: testCorePlatform, seedText: 'character-target-bound' });
    server.spawnPlayer({ id: 'player', position: [0.5, 34, 0.5] });
    const created = server.character({ kind: 'create', profile, position: [1.5, 34, 0.5] });
    if (created.kind !== 'created') throw new Error('Character was not created.');
    const entityId = created.character.entityId;
    let oldestTarget: Readonly<{ kind: 'entity'; ref: string; revision: number }> | undefined;

    for (let index = 0; index < 150; index += 1) {
      const id = `observed-${index}`;
      server.spawnAutonomousActor({ id, archetype: 'settler', position: [2.5, 34, 0.5] });
      const observed = server.character({ kind: 'observe', entityId });
      if (observed.kind !== 'observation') throw new Error('Character observation unavailable.');
      const target = observed.observation.visibleEntities.find((entry) => entry.type === 'npc')?.target;
      if (!target || target.kind !== 'entity') throw new Error('Observed target is unavailable.');
      oldestTarget ??= { kind: 'entity', ref: target.ref, revision: target.revision };
      server.despawnEntity(id);
    }

    for (let index = 0; index < 20; index += 1) {
      server.advanceGameplayRules(5);
      const character = server.getEntity(entityId);
      if (!character) throw new Error('Character entity is unavailable.');
      server.spawnWorldItem(character.position, { itemId: ItemIds.Berry, count: 1 });
      server.advanceGameplayRules(0.1);
    }

    const snapshot = server.freezePortableSaveSnapshot(1).gameplay.simulation.characters?.characters[0];
    if (!snapshot || !oldestTarget) throw new Error('Character target snapshot is unavailable.');
    expect(snapshot.targets).toHaveLength(128);
    expect(snapshot.targets.some((target) => target.ref === oldestTarget.ref)).toBe(false);
    expect(snapshot.targets.length).toBeLessThanOrEqual(128);
    expect(new Set(snapshot.targets.map((target) => target.ref)).size).toBe(snapshot.targets.length);
    // Consumed items no longer need a new live target reference merely to record a historical pickup.
    expect(snapshot.events.some((event) => event.type === 'item-picked-up')).toBe(true);
    server.spawnAutonomousActor({ id: 'observed-0', archetype: 'settler', position: [2.5, 34, 0.5] });
    expect(() =>
      server.character({
        kind: 'intent',
        entityId,
        requestId: 'evicted-target',
        expectedRevision: 0,
        goal: { kind: 'follow', target: oldestTarget },
      }),
    ).toThrow(/CHARACTER_TARGET_UNAVAILABLE/);
  });

  it('pages bounded events and rejects a corrupt character snapshot without changing current state', async () => {
    const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
    const server = new GameServer({ platform: testCorePlatform, seedText: 'character-validation', persistence });
    server.spawnPlayer({ id: 'player', position: [0.5, 34, 0.5] });
    const created = server.character({ kind: 'create', profile, position: [1.5, 34, 0.5] });
    if (created.kind !== 'created') throw new Error('Character was not created.');
    for (let index = 0; index < 40; index += 1)
      server.character({ kind: 'dialogue', entityId: created.character.entityId, text: `message-${index}` });
    const first = server.character({ kind: 'observe', entityId: created.character.entityId, sinceCursor: 0 });
    if (first.kind !== 'observation') throw new Error('Character observation unavailable.');
    expect(first.observation.events).toHaveLength(32);
    expect(first.observation.cursor).toBe(32);
    const second = server.character({
      kind: 'observe',
      entityId: created.character.entityId,
      sinceCursor: first.observation.cursor,
    });
    expect(second).toMatchObject({ kind: 'observation', observation: { cursor: 40, events: expect.any(Array) } });
    if (second.kind !== 'observation') throw new Error('Character observation unavailable.');
    expect(second.observation.events).toHaveLength(8);

    const before = server.character({ kind: 'list' });
    const corrupt = testCorePlatform.clone(server.freezeSaveSnapshot(4));
    const characters = corrupt.gameplay.simulation.characters?.characters;
    if (!characters?.[0]) throw new Error('Character snapshot unavailable.');
    (characters[0].profile as { riskTolerance?: number }).riskTolerance = 9;
    persistence.saveFrozenSnapshot(corrupt);
    await expect(server.restore()).rejects.toThrow(/Invalid gameplay snapshot/);
    expect(server.character({ kind: 'list' })).toEqual(before);

    const oversized = testCorePlatform.clone(server.freezeSaveSnapshot(5));
    const oversizedRecord = oversized.gameplay.simulation.characters?.characters[0] as
      | {
          targets: { kind: 'entity' | 'poi'; ref: string; targetId: string; revision: number }[];
          targetSequence: number;
        }
      | undefined;
    if (!oversizedRecord) throw new Error('Character snapshot unavailable.');
    while (oversizedRecord.targets.length <= 128) {
      oversizedRecord.targetSequence += 1;
      oversizedRecord.targets.push({
        kind: 'entity',
        ref: `target-${oversizedRecord.targetSequence}`,
        targetId: `oversized-${oversizedRecord.targetSequence}`,
        revision: 1,
      });
    }
    persistence.saveFrozenSnapshot(oversized);
    await expect(server.restore()).rejects.toThrow(/Invalid gameplay snapshot/);
    expect(server.character({ kind: 'list' })).toEqual(before);

    const inconsistent = testCorePlatform.clone(server.freezeSaveSnapshot(6));
    const inconsistentRecord = inconsistent.gameplay.simulation.characters?.characters[0] as
      { targets: { ref: string }[]; targetSequence: number } | undefined;
    if (!inconsistentRecord?.targets[0]) throw new Error('Character target snapshot unavailable.');
    inconsistentRecord.targets[0].ref = `target-${inconsistentRecord.targetSequence + 1}`;
    persistence.saveFrozenSnapshot(inconsistent);
    await expect(server.restore()).rejects.toThrow(/Invalid gameplay snapshot/);
    expect(server.character({ kind: 'list' })).toEqual(before);
  });

  it('uses the shared Headless world to move, pick up and eat through ordinary simulation', async () => {
    const session = await HeadlessSession.create({ platform: testCorePlatform, seedText: 'character-forage' });
    await session.world.clock({ kind: 'pause' });
    const camp = session.runtime.server.simulationSnapshot().pois.pois.find((poi) => poi.kind === 'camp');
    if (!camp) throw new Error('Starter camp is unavailable.');
    const created = await session.world.character({
      kind: 'create',
      profile,
      position: [camp.position[0] - 3, camp.position[1], camp.position[2]],
    });
    if (!created.ok || created.data.kind !== 'created') throw new Error('Character was not created.');
    const character = created.data.character;
    const initial = session.runtime.server.getEntity(character.entityId);
    if (!initial) throw new Error('Character entity is unavailable.');
    const foodPosition: [number, number, number] = [initial.position[0] - 5, initial.position[1], initial.position[2]];
    const spawned = await session.world.command({
      type: 'spawn-world-item',
      itemId: 'berry',
      count: 1,
      position: foodPosition,
    });
    expect(spawned).toMatchObject({ ok: true, data: { success: true } });

    for (let index = 0; index < 16; index += 1) await session.world.clock({ kind: 'advance', elapsedMs: 500 });

    const observed = await session.world.character({ kind: 'observe', entityId: character.entityId, sinceCursor: 0 });
    expect(observed).toMatchObject({ ok: true, data: { kind: 'observation' } });
    if (!observed.ok || observed.data.kind !== 'observation') throw new Error('Character observation unavailable.');
    const final = session.runtime.server.getEntity(character.entityId);
    expect(final?.position).not.toEqual(initial.position);
    expect(observed.data.observation.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['activity-started', 'item-picked-up', 'item-consumed']),
    );
    expect(
      session.runtime.server
        .queryEntities({ type: 'world-item' })
        .some((entity) => entity.position.every((value, index) => value === foodPosition[index])),
    ).toBe(false);
    expect(observed.data.observation.character.hunger).toBeLessThan(60);
    await session.dispose();
  }, 30_000);

  it('keeps the current movement action when a new request repeats the same goal with speech', async () => {
    const session = await HeadlessSession.create({ platform: testCorePlatform, seedText: 'character-repeat-goal' });
    await session.world.clock({ kind: 'pause' });
    const camp = session.runtime.server.simulationSnapshot().pois.pois.find((poi) => poi.kind === 'camp');
    if (!camp) throw new Error('Starter camp is unavailable.');
    const created = await session.world.character({ kind: 'create', profile, position: camp.position });
    if (!created.ok || created.data.kind !== 'created') throw new Error('Character was not created.');
    for (const item of session.runtime.server.queryEntities({ type: 'world-item' })) {
      session.runtime.server.despawnEntity(item.id);
    }
    await session.world.command({
      type: 'spawn-world-item',
      itemId: 'berry',
      count: 1,
      position: [camp.position[0] + 4, camp.position[1], camp.position[2]],
    });
    await session.world.clock({ kind: 'advance', elapsedMs: 200 });
    const actionId = session.runtime.server.getActorAction(created.data.character.entityId)?.id;
    expect(actionId).toBeTruthy();
    expect(
      await session.world.character({
        kind: 'intent',
        entityId: created.data.character.entityId,
        requestId: 'same-goal-with-speech',
        expectedRevision: 0,
        goal: { kind: 'forage' },
        say: 'I am still looking for food.',
      }),
    ).toMatchObject({ ok: true, data: { kind: 'intent', character: { revision: 1 } } });
    expect(session.runtime.server.getActorAction(created.data.character.entityId)?.id).toBe(actionId);
    const target = session.runtime.server
      .queryEntities({ type: 'world-item' })
      .find((entity) => entity.stack?.itemId === 'berry');
    if (!target) throw new Error('Forage target is unavailable.');
    session.runtime.server.despawnEntity(target.id);
    await session.world.clock({ kind: 'advance', elapsedMs: 200 });
    const fallback = await session.world.character({
      kind: 'observe',
      entityId: created.data.character.entityId,
      sinceCursor: 0,
    });
    if (!fallback.ok || fallback.data.kind !== 'observation') throw new Error('Character observation unavailable.');
    expect(fallback.data.observation.character.behaviorTree.runtime.skills).toEqual(
      expect.arrayContaining([expect.objectContaining({ nodeId: 'hunger-action', status: 'running' })]),
    );
    expect(fallback.data.observation.events.some((event) => event.type === 'fallback')).toBe(false);
    await session.dispose();
  }, 30_000);

  it('keeps follow active across completed movement segments and follows a moved player again', async () => {
    const session = await HeadlessSession.create({ platform: testCorePlatform, seedText: 'character-follow' });
    await session.world.clock({ kind: 'pause' });
    const player = session.runtime.server.getEntity(session.runtime.playerId);
    if (!player) throw new Error('Player is unavailable.');
    const created = await session.world.character({
      kind: 'create',
      profile,
      position: [player.position[0] + 2, player.position[1], player.position[2]],
    });
    if (!created.ok || created.data.kind !== 'created') throw new Error('Character was not created.');
    const entityId = created.data.character.entityId;
    const observed = await session.world.character({ kind: 'observe', entityId });
    if (!observed.ok || observed.data.kind !== 'observation') throw new Error('Character observation unavailable.');
    const playerTarget = observed.data.observation.visibleEntities.find((entry) => entry.type === 'player')?.target;
    if (!playerTarget) throw new Error('Visible player target is unavailable.');
    expect(
      await session.world.character({
        kind: 'intent',
        entityId,
        requestId: 'follow-player',
        expectedRevision: 0,
        goal: { kind: 'follow', target: playerTarget },
      }),
    ).toMatchObject({ ok: true });
    await session.world.clock({ kind: 'advance', elapsedMs: 2_000 });
    expect(await session.world.character({ kind: 'inspect', entityId })).toMatchObject({
      ok: true,
      data: { kind: 'state', character: { currentGoal: { goal: { kind: 'follow' }, status: 'active' } } },
    });
    const firstSegment = session.runtime.server.getActorAction(entityId)?.id;
    session.runtime.setPlayerPosition([player.position[0] - 4, player.position[1], player.position[2]]);
    await session.world.clock({ kind: 'advance', elapsedMs: 300 });
    const secondSegment = session.runtime.server.getActorAction(entityId)?.id;
    expect(secondSegment).toBeTruthy();
    if (firstSegment) expect(secondSegment).not.toBe(firstSegment);
    expect(await session.world.character({ kind: 'inspect', entityId })).toMatchObject({
      ok: true,
      data: { kind: 'state', character: { currentGoal: { status: 'active' } } },
    });
    await session.dispose();
  }, 30_000);

  it('keeps the tree-owned food search moving when no food is visible', async () => {
    const session = await HeadlessSession.create({ platform: testCorePlatform, seedText: 'character-roam' });
    await session.world.clock({ kind: 'pause' });
    for (const item of session.runtime.server.queryEntities({ type: 'world-item' }))
      session.runtime.server.despawnEntity(item.id);
    const camp = session.runtime.server.simulationSnapshot().pois.pois.find((poi) => poi.kind === 'camp');
    if (!camp) throw new Error('Starter camp is unavailable.');
    const created = await session.world.character({
      kind: 'create',
      profile,
      position: [camp.position[0] - 3, camp.position[1], camp.position[2]],
    });
    if (!created.ok || created.data.kind !== 'created') throw new Error('Character was not created.');
    const entityId = created.data.character.entityId;
    const before = session.runtime.server.getEntity(entityId)?.position;
    await session.world.clock({ kind: 'advance', elapsedMs: 2_000 });
    expect(session.runtime.server.getEntity(entityId)?.position).not.toEqual(before);
    expect(await session.world.character({ kind: 'inspect', entityId })).toMatchObject({
      ok: true,
      data: { kind: 'state', character: { currentGoal: { goal: { kind: 'forage' }, status: 'active' } } },
    });
    await session.dispose();
  }, 30_000);

  it('records a hit first, then lets the explicit tree flee and continue after danger clears', async () => {
    const session = await HeadlessSession.create({ platform: testCorePlatform, seedText: 'character-flee' });
    await session.world.clock({ kind: 'pause' });
    const player = session.runtime.server.getEntity(session.runtime.playerId);
    if (!player) throw new Error('Player is unavailable.');
    const created = await session.world.character({
      kind: 'create',
      profile,
      position: [player.position[0] + 2, player.position[1], player.position[2]],
    });
    if (!created.ok || created.data.kind !== 'created') throw new Error('Character was not created.');
    const entityId = created.data.character.entityId;
    const before = session.runtime.server.getEntity(entityId);
    expect(session.runtime.server.attackEntity(session.runtime.playerId, entityId)).toMatchObject({
      success: true,
      damage: 4,
    });
    expect(await session.world.character({ kind: 'inspect', entityId })).toMatchObject({
      ok: true,
      data: { kind: 'state', character: { currentGoal: { status: 'active' } } },
    });

    await session.world.clock({ kind: 'advance', elapsedMs: 1_000 });
    const fled = session.runtime.server.getEntity(entityId);
    expect(Math.abs((fled?.position[0] ?? 0) - player.position[0])).toBeGreaterThan(
      Math.abs((before?.position[0] ?? 0) - player.position[0]),
    );
    await session.world.clock({ kind: 'advance', elapsedMs: 2_500 });
    const resumed = await session.world.character({ kind: 'observe', entityId, sinceCursor: 0 });
    expect(resumed).toMatchObject({
      ok: true,
      data: { kind: 'observation', observation: { character: { currentGoal: { status: 'active' } } } },
    });
    if (!resumed.ok || resumed.data.kind !== 'observation') throw new Error('Character observation unavailable.');
    expect(resumed.data.observation.events).toContainEqual(
      expect.objectContaining({ type: 'activity-started', nodeId: 'threat-action' }),
    );
    expect(
      resumed.data.observation.character.behaviorTree.runtime.skills.some(
        (skill) => skill.skill === 'flee-threat' && skill.status === 'running',
      ),
    ).toBe(false);
    await session.dispose();
  }, 30_000);

  it('keeps a deceased character, its terminal event and normal inventory drops across checkpoints', async () => {
    const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
    const source = new GameServer({ platform: testCorePlatform, seedText: 'character-death', persistence });
    source.spawnPlayer({ id: 'player', position: [0.5, 34.6, 0.5] });
    const created = source.character({ kind: 'create', profile, position: [2, 34.6, 0.5] });
    if (created.kind !== 'created') throw new Error('Character was not created.');
    const entityId = created.character.entityId;
    const withInventory = testCorePlatform.clone(source.freezePortableSaveSnapshot(1));
    const record = withInventory.gameplay.simulation.characters?.characters[0];
    if (!record) throw new Error('Character snapshot unavailable.');
    (record.inventory as ({ itemId: string; count: number } | null)[])[0] = { itemId: ItemIds.Berry, count: 2 };
    persistence.saveFrozenSnapshot(withInventory);
    await source.restore();
    const active = source.character({ kind: 'inspect', entityId });
    if (active.kind !== 'state') throw new Error('Restored character state unavailable.');
    expect(active.character.inventory).toContainEqual({ itemId: ItemIds.Berry, count: 2 });

    for (let hit = 0; hit < 5; hit += 1) {
      expect(source.attackEntity('player', entityId)).toMatchObject({ success: true, damage: 4 });
      if (hit < 4) source.advanceGameplayRules(0.5);
    }
    expect(source.getEntity(entityId)).toBeNull();
    expect(source.character({ kind: 'inspect', entityId })).toMatchObject({
      kind: 'state',
      character: {
        lifecycle: 'deceased',
        behavior: 'deceased',
        inventory: Array.from({ length: 12 }, () => null),
        currentGoal: { status: 'failed', reason: 'killed' },
      },
    });
    expect(source.queryEntities({ type: 'world-item' })).toContainEqual(
      expect.objectContaining({ stack: { itemId: ItemIds.Berry, count: 2 } }),
    );
    await source.save(2);

    const restored = new GameServer({ platform: testCorePlatform, seedText: 'character-death', persistence });
    await restored.restore();
    const terminal = restored.character({ kind: 'observe', entityId, sinceCursor: 0 });
    expect(terminal).toMatchObject({
      kind: 'observation',
      observation: {
        character: { lifecycle: 'deceased', incarnation: created.character.incarnation },
        self: { health: 0 },
        visibleEntities: [],
        visiblePois: [],
      },
    });
    if (terminal.kind !== 'observation') throw new Error('Terminal character observation unavailable.');
    expect(terminal.observation.events).toContainEqual(
      expect.objectContaining({ type: 'goal-interrupted', reason: 'killed' }),
    );
  });
});
