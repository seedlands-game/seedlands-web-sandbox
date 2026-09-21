import { expect, it } from 'vitest';
import { GameplayRuntime, classicOptions } from '../../../../fixtures/classic/content';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { Voxel } from '@seedlands/stdlib/world/voxel';

const cells = new Map<string, number>([
  ['0,0,0', Voxel.Farmland],
  ['2,0,0', Voxel.Water],
]);
const voxel = ([x, y, z]: [number, number, number]) => cells.get(`${x},${y},${z}`) ?? (y === 1 ? Voxel.Air : undefined);
const createWorld = () => {
  const world = new GameplayRuntime({
    ...classicOptions(),
    platform: testCorePlatform,
    environmentSeed: 11,
    getWorldTime: () => 8,
    getVoxel: voxel,
    getLoadedVoxel: voxel,
    prepareVoxelEdit: () => {
      throw new Error('unexpected');
    },
  });
  world.spawnPlayer({ id: 'player', position: [0, 1, 0] });
  world.giveItem('player', { itemId: 'wheat-seeds', count: 2 });
  return world;
};

it('种植原子扣种，未知边界和重复位置不提交', () => {
  const world = createWorld();
  expect(world.crops.plant('player', [0, 0, 0])).toMatchObject({ success: true, crop: { stage: 0 } });
  expect(world.crops.plant('player', [0, 0, 0])).toEqual({ success: false, reason: 'occupied' });
  expect(world.crops.plant('player', [20, 0, 0])).toEqual({ success: false, reason: 'invalid-farmland' });
  expect(world.getInventory('player').slots.find((slot) => slot?.itemId === 'wheat-seeds')?.count).toBe(1);
});

it('确定性 random tick 只推进已加载且水化作物并可恢复', () => {
  const world = createWorld();
  world.crops.plant('player', [0, 0, 0]);
  world.crops.advance(80);
  expect(world.crops.list()[0]!.stage).toBe(7);
  const restored = createWorld();
  restored.restoreSnapshot(world.createSnapshot());
  expect(restored.crops.list()).toEqual(world.crops.list());
});

it('成熟收割发放小麦和种子并移除状态', () => {
  const world = createWorld();
  world.crops.plant('player', [0, 0, 0]);
  world.crops.advance(80);
  expect(world.crops.harvest('player', [0, 0, 0])).toEqual({ success: true, mature: true });
  expect(world.crops.list()).toEqual([]);
  expect(world.getInventory('player').slots.some((slot) => slot?.itemId === 'wheat')).toBe(true);
});
