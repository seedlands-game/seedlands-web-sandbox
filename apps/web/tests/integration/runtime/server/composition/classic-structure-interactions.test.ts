import { expect, it } from 'vitest';
import { GameplayRuntime } from '../../../../fixtures/classic/content';
import { classicGameplayDomainOptions } from './classic-gameplay-domain-options';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { Voxel } from '@seedlands/stdlib/world/voxel';

const cells = new Map<string, number>();
let time = 20;
const createWorld = () => {
  const world = new GameplayRuntime({
    ...classicGameplayDomainOptions(),
    platform: testCorePlatform,
    getWorldTime: () => time,
    setWorldTime: (value) => (time = value),
    getVoxel: ([x, y, z]) => cells.get(`${x},${y},${z}`) ?? Voxel.Air,
    getLoadedVoxel: ([x, y, z]) => cells.get(`${x},${y},${z}`) ?? Voxel.Air,
    prepareVoxelEdit: () => {
      throw new Error('unexpected single edit');
    },
    editBatch: ({ edits }) => {
      for (const edit of edits) cells.set(`${edit.x},${edit.y},${edit.z}`, edit.value);
      return { committed: true, worldRevision: 1, changedChunks: [] } as never;
    },
  });
  world.spawnPlayer({ id: 'player', position: [0, 0, 0] });
  return world;
};

it('门与床以一次批量提交占据两格且成功后扣物品', () => {
  const world = createWorld();
  world.giveItem('player', { itemId: 'wooden-door', count: 1 });
  expect(world.structures.place('player', [2, 0, 0])).toMatchObject({ success: true });
  expect(cells.get('2,0,0')).toBe(Voxel.WoodenDoor);
  expect(cells.get('2,1,0')).toBe(Voxel.WoodenDoor);
  world.giveItem('player', { itemId: 'bed', count: 1 });
  expect(world.structures.place('player', [2, 0, 2])).toMatchObject({ success: true });
  expect(cells.get('3,0,2')).toBe(Voxel.Bed);
});

it('夜间睡眠设置重生点并跳到清晨，白天拒绝', () => {
  const world = createWorld();
  cells.set('2,0,2', Voxel.Bed);
  cells.set('2,1,2', Voxel.Air);
  expect(world.structures.sleep('player', [2, 0, 2])).toMatchObject({ success: true, worldTime: 6 });
  expect(world.getPlayerState('player').spawnPosition).toEqual([2.5, 1, 2.5]);
  expect(world.structures.sleep('player', [2, 0, 2])).toEqual({ success: false, reason: 'not-night' });
});

it('打火石只在已加载空气点火并扣耐久', () => {
  const world = createWorld();
  world.giveItem('player', { itemId: 'flint-and-steel', count: 1, instance: { durability: 65 } });
  expect(world.structures.ignite('player', [1, 0, 0])).toEqual({ success: true });
  expect(
    world.getInventory('player').slots.find((slot) => slot?.itemId === 'flint-and-steel')?.instance?.durability,
  ).toBe(64);
  expect(world.environment.checkpoint().fires).toHaveLength(1);
});
