import { describe, expect, it } from 'vitest';
import { testCorePlatform } from '../support/core-platform';
import {
  createGameplayContent,
  type GameplayContent,
} from '../../packages/game-core/src/server/gameplay/gameplay-content';
import { GameplayRuntime } from '../../packages/game-core/src/server/gameplay/gameplay-runtime';
import { listMeleeDefinitions } from '../../packages/game-core/src/server/gameplay/combat-runtime';

const runtimeFor = (content: GameplayContent) => {
  const runtime = new GameplayRuntime({
    getVoxel: () => 0,
    prepareVoxelEdit: () => ({ committed: false }) as never,
    getWorldTime: () => 9,
    platform: testCorePlatform,
    content,
  });
  runtime.spawnPlayer({ id: 'player', position: [0.5, 1, 0.5] });
  return runtime;
};

const content = (stackLimit: number, outputCount = 2) =>
  createGameplayContent({
    items: [
      {
        id: 'demo:ore',
        name: 'Demo Ore',
        itemType: 'resource',
        stackLimit,
        capabilities: [],
      },
      {
        id: 'demo:ingot',
        name: 'Demo Ingot',
        itemType: 'resource',
        stackLimit,
        capabilities: [],
      },
    ],
    recipes: [
      {
        id: 'demo:smelt',
        inputs: [{ itemId: 'demo:ore', count: 1 }],
        outputs: [{ itemId: 'demo:ingot', count: outputCount }],
      },
    ],
    meleeDefinitions: listMeleeDefinitions(),
  });

describe('per-world gameplay content', () => {
  it('runs custom give, craft, drop and pickup through one exact content owner', () => {
    const runtime = runtimeFor(content(3));
    expect(runtime.giveItem('player', { itemId: 'demo:ore', count: 4 })).toMatchObject({ success: true });
    expect(runtime.getInventory('player').slots.slice(0, 2)).toEqual([
      { itemId: 'demo:ore', count: 3 },
      { itemId: 'demo:ore', count: 1 },
    ]);
    expect(runtime.listRecipes().map((recipe) => recipe.id)).toEqual(['demo:smelt']);
    expect(runtime.listCraftable('player').map((recipe) => recipe.id)).toEqual(['demo:smelt']);
    expect(runtime.craft('player', 'demo:smelt')).toMatchObject({ success: true });
    const ingotSlot = runtime.getInventory('player').slots.findIndex((stack) => stack?.itemId === 'demo:ingot');
    const dropped = runtime.dropItem('player', ingotSlot, 1);
    expect(dropped).toMatchObject({ success: true, entity: { stack: { itemId: 'demo:ingot', count: 1 } } });
    if (!dropped.success) throw new Error('Expected custom item drop.');
    expect(runtime.pickupItem('player', dropped.entity.id)).toEqual({ success: true });
    expect(runtime.getInventory('player').slots).toContainEqual({ itemId: 'demo:ingot', count: 2 });
  });

  it('roundtrips custom inventories and world items through V4 with the same content', () => {
    const configured = content(4);
    const source = runtimeFor(configured);
    source.giveItem('player', { itemId: 'demo:ore', count: 3 });
    source.spawnWorldItem([1, 1, 0.5], { itemId: 'demo:ingot', count: 2 });
    source.spawn({
      id: 'target',
      type: 'creature',
      position: [1.5, 1, 0.5],
      health: 20,
      maxHealth: 20,
    });
    expect(source.attackEntity('player', 'target')).toMatchObject({ success: true, damage: 4 });
    const snapshot = source.createSnapshot();

    const restored = runtimeFor(configured);
    expect(restored.restoreSnapshot(snapshot)).toEqual({ version: 4, worldTime: 9 });
    expect(restored.getInventory('player').slots[0]).toEqual({ itemId: 'demo:ore', count: 3 });
    expect(restored.queryEntities({ type: 'world-item' })).toContainEqual(
      expect.objectContaining({ stack: { itemId: 'demo:ingot', count: 2 } }),
    );
    expect(restored.getCombatState('player').active).toMatchObject({ phase: 'hit' });
    expect(restored.getEntity('target')).toMatchObject({ health: 16 });
    restored.advanceRules(1);
    expect(restored.getEntity('target')).toMatchObject({ health: 16 });
  });

  it('isolates identical item ids, stack limits and recipes between simultaneous worlds', () => {
    const small = content(2, 1);
    const large = content(5, 3);
    const smallWorld = runtimeFor(small);
    const largeWorld = runtimeFor(large);
    smallWorld.giveItem('player', { itemId: 'demo:ore', count: 5 });
    largeWorld.giveItem('player', { itemId: 'demo:ore', count: 5 });
    expect(smallWorld.getInventory('player').slots.slice(0, 3)).toEqual([
      { itemId: 'demo:ore', count: 2 },
      { itemId: 'demo:ore', count: 2 },
      { itemId: 'demo:ore', count: 1 },
    ]);
    expect(largeWorld.getInventory('player').slots.slice(0, 2)).toEqual([{ itemId: 'demo:ore', count: 5 }, null]);
    expect(smallWorld.craft('player', 'demo:smelt')).toMatchObject({ success: true });
    expect(largeWorld.craft('player', 'demo:smelt')).toMatchObject({ success: true });
    expect(smallWorld.getInventory('player').slots).toContainEqual({ itemId: 'demo:ingot', count: 1 });
    expect(largeWorld.getInventory('player').slots).toContainEqual({ itemId: 'demo:ingot', count: 3 });
  });

  it('rejects unknown runtime and snapshot items atomically without builtin fallback', () => {
    const configured = content(3);
    const runtime = runtimeFor(configured);
    const before = runtime.createSnapshot();
    expect(() => runtime.giveItem('player', { itemId: 'berry', count: 1 })).toThrow(/unknown item/i);
    expect(runtime.createSnapshot()).toEqual(before);

    const malformed = structuredClone(before);
    malformed.entityStore.actors[0].inventory[0] = { itemId: 'demo:missing', count: 1 };
    expect(() => runtime.restoreSnapshot(malformed)).toThrow(/unknown item|inventory/i);
    expect(runtime.createSnapshot()).toEqual(before);
  });

  it('freezes content projections and validates custom identities and recipe references', () => {
    const configured = content(3);
    expect(Object.isFrozen(configured)).toBe(true);
    expect(Object.isFrozen(configured.items.list())).toBe(true);
    expect(Object.isFrozen(configured.recipes.list())).toBe(true);
    expect(Object.isFrozen(configured.meleeDefinitions)).toBe(true);
    expect(() =>
      createGameplayContent({
        items: [{ id: 'bad id', name: 'bad', itemType: 'resource', stackLimit: 1, capabilities: [] }],
        recipes: [],
        meleeDefinitions: listMeleeDefinitions(),
      }),
    ).toThrow(/identity/i);
    expect(() =>
      createGameplayContent({
        items: [{ id: 'demo:known', name: 'known', itemType: 'resource', stackLimit: 1, capabilities: [] }],
        recipes: [
          {
            id: 'demo:bad-recipe',
            inputs: [{ itemId: 'demo:known', count: 1 }],
            outputs: [{ itemId: 'demo:unknown', count: 1 }],
          },
        ],
        meleeDefinitions: listMeleeDefinitions(),
      }),
    ).toThrow(/unknown item/i);
  });
});
