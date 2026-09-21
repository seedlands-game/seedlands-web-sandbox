import { expect, it } from 'vitest';
import { GameplayRuntime, classicOptions } from '../../../../fixtures/classic/content';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { Voxel } from '@seedlands/stdlib/world/voxel';

const createWorld = () => {
  const world = new GameplayRuntime({
    ...classicOptions(),
    platform: testCorePlatform,
    getWorldTime: () => 0,
    getVoxel: () => Voxel.Air,
    prepareVoxelEdit: () => {
      throw new Error('unexpected');
    },
  });
  world.spawnPlayer({ id: 'player', position: [0, 0, 0] });
  world.spawnAutonomous({ id: 'sheep', archetype: 'sheep', position: [2, 0, 0] }, { archetype: 'sheep' });
  world.spawnAutonomous({ id: 'wolf', archetype: 'wolf', position: [3, 0, 0] }, { archetype: 'wolf' });
  return world;
};

it('剪羊毛原子消耗耐久、发放羊毛并保存已剪状态', () => {
  const world = createWorld();
  const before = world.createSnapshot();
  expect(world.shearSheep('player', 'sheep')).toEqual({ success: false, reason: 'requires-shears' });
  expect(world.createSnapshot().entityStore).toEqual(before.entityStore);
  world.giveItem('player', { itemId: 'shears', count: 1, instance: { durability: 2 } });
  expect(world.shearSheep('player', 'sheep')).toEqual({ success: true, count: 2, color: 'white' });
  expect(world.getInventory('player').slots).toContainEqual({ itemId: 'wool', count: 2 });
  expect(world.getInventory('player').slots[0]?.instance?.durability).toBe(1);
  expect(world.shearSheep('player', 'sheep')).toEqual({ success: false, reason: 'already-sheared' });
  const restored = createWorld();
  restored.restoreSnapshot(world.createSnapshot());
  expect(restored.getEntity('sheep')).toBeTruthy();
  expect(restored.shearSheep('player', 'sheep')).toEqual({ success: false, reason: 'already-sheared' });
});

it('狼驯服按稳定尝试消耗骨头，主人可切换坐下并恢复', () => {
  const world = createWorld();
  world.giveItem('player', { itemId: 'bone', count: 3 });
  let result;
  do result = world.tameWolf('player', 'wolf');
  while (result.success && !result.tamed);
  expect(result).toEqual({ success: true, tamed: true });
  expect(world.toggleWolfSitting('other', 'wolf')).toEqual({ success: false, reason: 'not-owner' });
  expect(world.toggleWolfSitting('player', 'wolf')).toEqual({ success: true, sitting: true });
  const restored = createWorld();
  restored.restoreSnapshot(world.createSnapshot());
  expect(restored.toggleWolfSitting('player', 'wolf')).toEqual({ success: true, sitting: false });
});

it('16色染料改变羊毛颜色，吃草再生羊毛且保存颜色', () => {
  const world = createWorld();
  world.giveItem('player', { itemId: 'blue-dye', count: 1 });
  expect(world.dyeSheep('player', 'sheep')).toEqual({ success: true, color: 'blue' });
  world.giveItem('player', { itemId: 'shears', count: 1, instance: { durability: 2 } });
  expect(world.shearSheep('player', 'sheep')).toEqual({ success: true, count: 2, color: 'blue' });
  expect(world.regrowSheepWool('sheep')).toEqual({ success: true });
  const restored = createWorld();
  restored.restoreSnapshot(world.createSnapshot());
  expect(restored.shearSheep('player', 'sheep')).toEqual({ success: true, count: 2, color: 'blue' });
});
