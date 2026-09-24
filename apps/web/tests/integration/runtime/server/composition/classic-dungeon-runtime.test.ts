import { expect, it } from 'vitest';
import { GameplayRuntime } from '../../../../fixtures/classic/content';
import { classicGameplayDomainOptions } from './classic-gameplay-domain-options';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { Voxel } from '@seedlands/stdlib/world/voxel';

const createWorld = () => {
  const cells = new Map([
    ['0,0,0', Voxel.Spawner],
    ['2,0,0', Voxel.DungeonChest],
  ]);
  const world = new GameplayRuntime({
    ...classicGameplayDomainOptions(),
    platform: testCorePlatform,
    environmentSeed: 42,
    getWorldTime: () => 0,
    getVoxel: ([x, y, z]) => cells.get([x, y, z].join(',')) ?? Voxel.Air,
    getLoadedVoxel: ([x, y, z]) => cells.get([x, y, z].join(',')) ?? Voxel.Air,
    biomeAt: () => 'plains',
    prepareVoxelEdit: () => {
      throw new Error('unexpected edit');
    },
  });
  world.spawnPlayer({ id: 'player', position: [1, 0, 0] });
  return world;
};

it('加载的暗处刷怪笼每20秒生成并随快照恢复冷却', () => {
  const world = createWorld();
  expect(world.environmentQueries.attemptDungeonSpawner('dungeon:0,0', [0, 0, 0], 19)).toMatchObject({
    success: false,
    reason: 'spawner-cooldown',
  });
  const restored = createWorld();
  restored.restoreSnapshot(world.createSnapshot());
  expect(restored.environmentQueries.attemptDungeonSpawner('dungeon:0,0', [0, 0, 0], 1)).toMatchObject({
    success: true,
    entity: { archetype: 'zombie' },
  });
  restored.setDifficulty('peaceful');
  expect(restored.environmentQueries.attemptDungeonSpawner('dungeon:0,0', [0, 0, 0], 20)).toEqual({
    success: false,
    reason: 'spawn-rejected',
  });
});

it('地牢箱首次确定性发放且开启状态随快照恢复', () => {
  const world = createWorld();
  expect(world.environmentQueries.openDungeonChest('player', 'dungeon:0,0', 0, [2, 0, 0])).toMatchObject({
    success: true,
  });
  expect(world.environmentQueries.openDungeonChest('player', 'dungeon:0,0', 0, [2, 0, 0])).toEqual({
    success: false,
    reason: 'chest-opened',
  });
  const restored = createWorld();
  restored.restoreSnapshot(world.createSnapshot());
  expect(restored.environmentQueries.openDungeonChest('player', 'dungeon:0,0', 0, [2, 0, 0])).toEqual({
    success: false,
    reason: 'chest-opened',
  });
});
