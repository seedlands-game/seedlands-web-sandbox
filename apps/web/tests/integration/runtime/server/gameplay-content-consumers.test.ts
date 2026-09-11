import { describe, expect, it } from 'vitest';
import { testCorePlatform } from '../../../../../../packages/stdlib/tests/support/core-platform';
import { GameServer } from '../../../fixtures/classic/content';
import { createGameplayContent } from '../../../../../../packages/stdlib/src/server/gameplay/gameplay-content';
import { executeGameplayCommand } from '../../../../../../packages/stdlib/src/server/commands/gameplay-command-handler';
import { parseSlashCommand } from '../../../../../../packages/stdlib/src/server/commands/slash-command-parser';
import { AuthorityLogicObservationBuilder } from '../../../../../../packages/stdlib/src/server/authority/logic-observation-builder';
import type { AuthoritySnapshot } from '../../../../../../packages/stdlib/src/server/authority/authority-session';

const CUSTOM_FOOD = 'example:moon-fruit';
const content = createGameplayContent({
  items: [
    {
      id: CUSTOM_FOOD,
      name: 'Moon Fruit',
      itemType: 'food',
      stackLimit: 16,
      capabilities: [{ type: 'consume', hungerRestore: 6 }],
    },
  ],
  recipes: [],
  meleeDefinitions: [],
  actorProfiles: [
    {
      archetype: 'grazer',
      entityType: 'creature',
      maxHealth: 12,
      navigation: { speed: 1.6, perceptionRange: 10 },
    },
  ],
});

const source = {
  actorId: 'developer',
  sourceType: 'developer',
  entityId: 'player',
  capabilities: ['query', 'mutation'] as const,
};

const customServer = () => new GameServer({ seedText: 'custom-content', platform: testCorePlatform, content });

const authoritySnapshot = (server: GameServer): AuthoritySnapshot => {
  const bodies = server.queryEntities().map((entity) => {
    if (entity.type === 'station') throw new Error('Station cannot enter authority body fixture.');
    return {
      id: entity.id,
      type: entity.type,
      ...(entity.archetype ? { archetype: entity.archetype } : {}),
      body: {
        position: { x: entity.position[0], y: entity.position[1], z: entity.position[2] },
        velocity: {
          x: entity.physicsVelocity?.[0] ?? 0,
          y: entity.physicsVelocity?.[1] ?? 0,
          z: entity.physicsVelocity?.[2] ?? 0,
        },
      },
      grounded: false,
      contacts: [],
    };
  });
  return {
    kind: 'snapshot',
    protocolVersion: 1,
    epoch: 'custom-content',
    physicsTick: 0,
    commitSequence: 0,
    worldMutationCount: 0,
    acknowledgedInputSequence: 0,
    inputResyncRequired: false,
    activeTimeMs: 0,
    integratedPhysicsTimeMs: 0,
    physicsDebtMs: 0,
    player: bodies.find((body) => body.id === 'player')!,
    entities: bodies,
    chunkRevisions: {},
    worldRevision: 0,
    worldTime: server.worldTime,
    paused: false,
  };
};

describe('per-world gameplay content consumers', () => {
  it('parses namespaced ids syntactically, then validates them against the actual world before mutation', async () => {
    expect(parseSlashCommand('/give Example:Moon-Fruit 2')).toEqual({
      success: true,
      command: { type: 'give-item', itemId: CUSTOM_FOOD, count: 2 },
    });
    expect(parseSlashCommand('/give example:missing 1')).toMatchObject({ success: true });
    expect(parseSlashCommand('/give bad:id:again 1')).toMatchObject({ success: false });

    const server = customServer();
    server.spawnPlayer({ id: 'player', position: [0.5, 80, 0.5] });
    const before = server.getInventory('player');
    await expect(
      executeGameplayCommand(server, source, { type: 'give-item', itemId: 'example:missing', count: 1 }),
    ).rejects.toThrow(/unknown item/i);
    expect(server.getInventory('player')).toEqual(before);
  });

  it('uses custom definitions for real server inspect, give and player consume paths', async () => {
    const server = customServer();
    server.spawnPlayer({ id: 'player', position: [0.5, 80, 0.5] });
    const inspected = await executeGameplayCommand(server, source, { type: 'query-item-definitions' });
    expect(inspected.data).toEqual({ items: [expect.objectContaining({ id: CUSTOM_FOOD, hungerRestore: 6 })] });

    await expect(
      executeGameplayCommand(server, source, { type: 'give-item', itemId: CUSTOM_FOOD, count: 2 }),
    ).resolves.toMatchObject({ message: `Gave 2 ${CUSTOM_FOOD}.` });
    server.setHungerForDebug('player', 10);
    expect(server.useSelectedItem('player')).toMatchObject({ success: true });
    expect(server.getPlayerState('player').hunger).toBe(16);
    expect(server.getInventory('player').slots[0]).toEqual({ itemId: CUSTOM_FOOD, count: 1 });
  });

  it('uses the same world registry for actor authority consumption and logic observation', () => {
    const server = customServer();
    server.spawnPlayer({ id: 'player', position: [0.5, 80, 0.5] });
    server.spawnAutonomousActor({
      id: 'grazer',
      archetype: 'grazer',
      position: [1, 80, 0.5],
      registration: { hunger: 80 },
    });
    const food = server.spawnWorldItem([1.2, 80, 0.5], { itemId: CUSTOM_FOOD, count: 1 });
    server.advanceGameplayRules(0.1);

    expect(server.applyActorAuthorityAction('grazer', { type: 'consume-world-item', targetId: food.id })).toMatchObject(
      {
        accepted: true,
        changed: true,
      },
    );
    expect(server.getEntity(food.id)).toBeNull();

    const observedFood = server.spawnWorldItem([2, 80, 0.5], { itemId: CUSTOM_FOOD, count: 2 });
    const observation = new AuthorityLogicObservationBuilder(testCorePlatform.clone, 'custom-content', server).build(
      1,
      authoritySnapshot(server),
    );
    expect(observation.entities.find((entity) => entity.id === observedFood.id)?.stack).toEqual({
      itemId: CUSTOM_FOOD,
      count: 2,
      edible: true,
      hungerRestore: 6,
    });
  });

  it('keeps custom definitions isolated per world while retaining default content', async () => {
    const custom = customServer();
    const defaults = new GameServer({ seedText: 'default-content', platform: testCorePlatform });
    custom.spawnPlayer({ id: 'player', position: [0.5, 80, 0.5] });
    defaults.spawnPlayer({ id: 'player', position: [0.5, 80, 0.5] });

    expect(custom.itemDefinitions.has(CUSTOM_FOOD)).toBe(true);
    expect(custom.itemDefinitions.has('berry')).toBe(false);
    expect(defaults.itemDefinitions.has(CUSTOM_FOOD)).toBe(false);
    expect(defaults.itemDefinitions.has('berry')).toBe(true);
    await expect(
      executeGameplayCommand(defaults, source, { type: 'give-item', itemId: CUSTOM_FOOD, count: 1 }),
    ).rejects.toThrow(/unknown item/i);
    await expect(
      executeGameplayCommand(defaults, source, { type: 'give-item', itemId: 'berry', count: 1 }),
    ).resolves.toMatchObject({ message: 'Gave 1 berry.' });
  });
});
