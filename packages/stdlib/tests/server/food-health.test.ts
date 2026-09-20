import { describe, expect, it } from 'vitest';
import { createGameplayContent } from '../../src/server/gameplay/gameplay-content';
import { GameplayRuntime } from '../../src/server/gameplay/gameplay-runtime';
import { buildInventoryActionCandidate } from '../../src/server/gameplay/modules/inventory-action-model';
import { testCorePlatform } from '../support/core-platform';

const content = () =>
  createGameplayContent({
    items: [
      {
        id: 'test:apple',
        name: 'Apple',
        itemType: 'food',
        stackLimit: 1,
        capabilities: [{ type: 'consume', healthRestore: 4 }],
      },
    ],
    recipes: [],
    meleeDefinitions: [],
  });
const actor = (health: number) => ({
  version: 1,
  reference: { entityId: 'alice', epoch: 1, lifetime: 1 },
  kind: 'player',
  slots: [{ itemId: 'test:apple', count: 1 }, null],
  equipment: { selectedSlot: 0, hotbarSize: 2 },
  lifecycle: 'alive',
  needs: { hunger: 20, maxHunger: 20, meaning: 'satiety' },
  vitals: { health, maxHealth: 20 },
  inventoryRevision: 0,
  cursor: { version: 1, revision: 0, stack: null, origin: null },
});
describe('health-restoring food', () => {
  it('builds a detached inventory/health candidate even at full hunger', () => {
    const before = actor(17);
    const next = buildInventoryActionCandidate(content(), { kind: 'consume', actor: before, input: { slot: 0 } });
    expect(next.health).toBe(20);
    expect(next.hunger.hunger).toBe(20);
    expect(next.slots[0]).toBeNull();
    expect(before.vitals.health).toBe(17);
    expect(before.slots[0]?.count).toBe(1);
  });
  it('rejects full health and missing health observation without consuming inventory', () => {
    const before = actor(20);
    expect(() =>
      buildInventoryActionCandidate(content(), { kind: 'consume', actor: before, input: { slot: 0 } }),
    ).toThrow('health-full');
    const legacy: Partial<ReturnType<typeof actor>> = actor(12);
    delete legacy.vitals;
    expect(() =>
      buildInventoryActionCandidate(content(), { kind: 'consume', actor: legacy, input: { slot: 0 } }),
    ).toThrow('health-unavailable');
    expect(before.slots[0]?.count).toBe(1);
  });
  it('rejects invalid food definitions and forged health projections', () => {
    for (const amount of [0, -1, NaN, Infinity]) {
      expect(() =>
        createGameplayContent({
          items: [
            {
              id: 'test:bad',
              name: 'Bad',
              itemType: 'food',
              stackLimit: 1,
              capabilities: [{ type: 'consume', healthRestore: amount }],
            },
          ],
          recipes: [],
          meleeDefinitions: [],
        }),
      ).toThrow();
    }
    expect(() =>
      buildInventoryActionCandidate(content(), {
        kind: 'consume',
        actor: { ...actor(12), vitals: { health: 21, maxHealth: 20 } },
        input: { slot: 0 },
      }),
    ).toThrow();
  });
  it('commits food and health together and preserves both across owner restore', () => {
    const world = new GameplayRuntime({
      content: content(),
      platform: testCorePlatform,
      getVoxel: () => 0,
      getWorldTime: () => 9,
      prepareVoxelEdit: () => {
        throw new Error('unused');
      },
    });
    world.spawnPlayer({ id: 'alice', position: [0, 2, 0] });
    expect(world.giveItem('alice', { itemId: 'test:apple', count: 1 }).success).toBe(true);
    expect(world.useInventoryItem('alice', 0)).toMatchObject({ success: false, reason: 'health-full' });
    expect(world.getInventory('alice').slots[0]?.count).toBe(1);
    world.applyDamage('fixture', 'alice', 7, 'test');
    expect(world.useInventoryItem('alice', 0).success).toBe(true);
    expect(world.getPlayerState('alice').health).toBe(17);
    expect(world.getInventory('alice').slots[0]).toBeNull();
    world.restoreSnapshot(world.createSnapshot());
    expect(world.getPlayerState('alice').health).toBe(17);
    expect(world.getInventory('alice').slots[0]).toBeNull();
  });
});
