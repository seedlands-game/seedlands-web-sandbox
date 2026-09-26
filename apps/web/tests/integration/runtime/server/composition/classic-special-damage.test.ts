import { expect, it } from 'vitest';
import { GameplayRuntime } from '../../../../fixtures/classic/content';
import { classicGameplayDomainOptions } from './classic-gameplay-domain-options';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { Voxel } from '@seedlands/stdlib/world/voxel';

const createWorld = () => {
  const world = new GameplayRuntime({
    ...classicGameplayDomainOptions(),
    platform: testCorePlatform,
    getWorldTime: () => 12,
    getVoxel: () => Voxel.Air,
    prepareVoxelEdit: () => {
      throw new Error('unexpected');
    },
  });
  world.spawnPlayer({ id: 'player', position: [0, 0, 0] });
  return world;
};

it('晒伤、溺水、仙人掌和火统一进入正式伤害 owner', () => {
  const world = createWorld();
  for (const cause of ['sunlight', 'drowning', 'cactus', 'fire'] as const)
    expect(world.specialDamage.apply('player', cause, 1)).toEqual({ success: true, damage: 1 });
  expect(world.getPlayerState('player').health).toBe(16);
});

it('跌落按超过三格的距离结算并拒绝无伤输入', () => {
  const world = createWorld();
  expect(world.specialDamage.applyFall('player', 7.2)).toEqual({ success: true, damage: 5 });
  expect(world.specialDamage.applyFall('player', 3)).toEqual({ success: false, reason: 'non-damaging-fall' });
  expect(world.specialDamage.apply('player', 'fire', 0)).toEqual({
    success: false,
    reason: 'invalid-special-damage',
  });
  expect(world.getPlayerState('player').health).toBe(15);
});

it('死亡目标拒绝后续特殊伤害且不再改变生命值', () => {
  const world = createWorld();
  expect(world.specialDamage.apply('player', 'drowning', 20)).toMatchObject({ success: true, damage: 20 });
  expect(world.specialDamage.apply('player', 'fire', 1)).toEqual({
    success: false,
    reason: 'target-unavailable',
  });
  expect(world.getPlayerState('player').health).toBe(0);
});
