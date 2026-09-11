import { expect, it } from 'vitest';
import { GameplayRuntime } from '../../src/server/gameplay/gameplay-runtime';
import { createGameplayContent } from '../../src/server/gameplay/gameplay-content';
import { createInventoryCandidate } from '../../src/server/gameplay/modules/inventory-api';
import { testCorePlatform } from '../support/core-platform';

const content = () =>
  createGameplayContent({
    items: [
      { id: 'test:pick', name: 'Pick', itemType: 'tool', stackLimit: 1, durability: { max: 10 }, capabilities: [] },
    ],
    recipes: [],
    meleeDefinitions: [],
  });
const runtime = () =>
  new GameplayRuntime({
    content: content(),
    platform: testCorePlatform,
    getVoxel: () => 0,
    getWorldTime: () => 9,
    prepareVoxelEdit: () => {
      throw new Error('unused');
    },
  });
it('keeps a damaged tool through actor drop, ECS world item, pickup and V4 owner restore', () => {
  const world = runtime();
  world.spawnPlayer({ id: 'alice', position: [0, 2, 0] });
  const tool = { itemId: 'test:pick', count: 1, instance: { durability: 7 } };
  expect(world.giveItem('alice', tool).success).toBe(true);
  const dropped = world.dropItem('alice', 0, 1);
  expect(dropped.success).toBe(true);
  if (!dropped.success) throw new Error(dropped.reason);
  expect(world.getEntity(dropped.entity.id)?.stack).toEqual(tool);
  const saved = world.createSnapshot();
  world.restoreSnapshot(saved);
  expect(world.getEntity(dropped.entity.id)?.stack).toEqual(tool);
  expect(world.pickupItem('alice', dropped.entity.id)).toMatchObject({ success: true });
  expect(world.getInventory('alice').slots[0]).toEqual(tool);
  tool.instance.durability = 1;
  expect(world.getInventory('alice').slots[0]?.instance?.durability).toBe(7);
});
it('validates registered inventory candidates without discarding instance state', () => {
  const items = content().items;
  const candidate = createInventoryCandidate(items, [{ itemId: 'test:pick', count: 1, instance: { durability: 3 } }]);
  expect(candidate.slot(0)?.instance?.durability).toBe(3);
  expect(() =>
    createInventoryCandidate(items, [{ itemId: 'test:pick', count: 1, instance: { durability: 11 } }]),
  ).toThrow();
});
