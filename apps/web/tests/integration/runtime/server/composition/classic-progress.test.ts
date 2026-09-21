import { expect, it } from 'vitest';
import { GameplayRuntime, classicOptions } from '../../../../fixtures/classic/content';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { Voxel } from '@seedlands/stdlib/world/voxel';

const world = () => {
  const runtime = new GameplayRuntime({
    ...classicOptions(),
    platform: testCorePlatform,
    getWorldTime: () => 12,
    getVoxel: () => Voxel.Air,
    prepareVoxelEdit: () => {
      throw new Error('unexpected');
    },
  });
  runtime.spawnPlayer({ id: 'player', position: [0, 0, 0] });
  return runtime;
};

it('正式进度只接受有界正增量并一次性解锁里程碑', () => {
  const runtime = world();
  expect(runtime.progress.record('player', 'blocks-mined', 1)).toMatchObject({ unlocked: ['first-block'] });
  expect(runtime.progress.record('player', 'blocks-mined', 1)).toMatchObject({ unlocked: [] });
  expect(runtime.progress.snapshot('player')).toMatchObject({ statistics: { 'blocks-mined': 2 } });
  expect(runtime.progress.record('player', 'blocks-mined', 0)).toMatchObject({ success: false });
});

it('统计与成就在 Gameplay V4 checkpoint 恢复且不重复解锁', () => {
  const runtime = world();
  runtime.progress.record('player', 'items-crafted', 1);
  const restored = world();
  restored.restoreSnapshot(runtime.createSnapshot());
  expect(restored.progress.snapshot('player')).toMatchObject({
    statistics: { 'items-crafted': 1 },
    achievements: ['first-craft'],
  });
  expect(restored.progress.record('player', 'items-crafted', 1)).toMatchObject({ unlocked: [] });
});
