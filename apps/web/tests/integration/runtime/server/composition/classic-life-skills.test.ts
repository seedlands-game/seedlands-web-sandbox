import { expect, it } from 'vitest';
import { GameplayRuntime } from '../../../../fixtures/classic/content';
import { classicGameplayDomainOptions } from './classic-gameplay-domain-options';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { Voxel } from '@seedlands/stdlib/world/voxel';

const createWorld = () => {
  const world = new GameplayRuntime({
    ...classicGameplayDomainOptions('inventory-actions'),
    platform: testCorePlatform,
    environmentSeed: 9,
    getWorldTime: () => 12,
    getVoxel: ([x, y]) => (x === 4 && y === 0 ? Voxel.Water : y < 0 ? Voxel.Stone : Voxel.Air),
    getLoadedVoxel: ([x, y]) => (x === 4 && y === 0 ? Voxel.Water : y < 0 ? Voxel.Stone : Voxel.Air),
    prepareVoxelEdit: () => {
      throw new Error('unexpected');
    },
  });
  world.spawnPlayer({ id: 'player', position: [0, 0, 0] });
  world.spawnAutonomous({ id: 'cow', archetype: 'cow', position: [2, 0, 0] }, { archetype: 'cow' });
  return world;
};

it('鱼钩等待由 seed/序列决定并随快照恢复，收杆守恒', () => {
  const world = createWorld();
  world.giveItem('player', { itemId: 'fishing-rod', count: 1, instance: { durability: 3 } });
  expect(world.lifeSkills.castFishingRod('player', [4, 0, 0])).toMatchObject({ success: true });
  world.lifeSkills.advance(4);
  const restored = createWorld();
  restored.restoreSnapshot(world.createSnapshot());
  restored.lifeSkills.advance(20);
  expect(restored.lifeSkills.retrieveFishingRod('player')).toMatchObject({ success: true, caught: true });
  expect(restored.getInventory('player').slots).toContainEqual({ itemId: 'raw-fish', count: 1 });
});

it('奶桶与鸡蛋使用保持库存守恒并稳定孵化', () => {
  const world = createWorld();
  world.giveItem('player', { itemId: 'bucket', count: 1 });
  expect(world.lifeSkills.milkCow('player', 'cow')).toMatchObject({ success: true });
  expect(world.getInventory('player').slots).toContainEqual({ itemId: 'milk-bucket', count: 1 });
  expect(world.lifeSkills.drinkMilk('player')).toEqual({ success: true });
  expect(world.getInventory('player').slots).toContainEqual({ itemId: 'bucket', count: 1 });
  world.giveItem('player', { itemId: 'egg', count: 8 });
  world.selectHotbarSlot('player', 1);
  const hatched = Array.from({ length: 8 }, (_, index) =>
    world.lifeSkills.throwEgg('player', [5 + index, 0, 0]),
  ).filter((x) => x.success && x.hatched);
  expect(hatched).toHaveLength(1);
  expect(world.queryEntities({ type: 'creature' }).some((entity) => entity.archetype === 'chicken')).toBe(true);
});
