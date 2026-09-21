import { expect, it } from 'vitest';
import { selectSpawn, shouldDespawnActor } from '@seedlands/stdlib/server/gameplay/spawn-policy';
import { GameplayRuntime, classicOptions } from '../../../../fixtures/classic/content';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { Voxel } from '@seedlands/stdlib/world/voxel';

const candidates = [
  { archetype: 'cow', disposition: 'passive', weight: 8 },
  { archetype: 'pig', disposition: 'passive', weight: 10 },
  { archetype: 'zombie', disposition: 'hostile', weight: 10 },
  { archetype: 'skeleton', disposition: 'hostile', weight: 10 },
] as const;
const context = {
  seed: 42,
  tick: 100,
  position: [40, 30, 40] as const,
  light: 0,
  biome: 'plains',
  difficulty: 'normal' as const,
  nearestPlayerDistance: 30,
  currentCategoryCount: 0,
  categoryLimit: 16,
};

it('固定 seed/tick 稳定选择并遵守亮度、距离、难度与上限', () => {
  expect(selectSpawn(candidates, context)).toBe(selectSpawn(candidates, context));
  expect(['zombie', 'skeleton']).toContain(selectSpawn(candidates, context));
  expect(selectSpawn(candidates, { ...context, difficulty: 'peaceful' })).toBeNull();
  expect(selectSpawn(candidates, { ...context, nearestPlayerDistance: 23.9 })).toBeNull();
  expect(selectSpawn(candidates, { ...context, currentCategoryCount: 16 })).toBeNull();
  expect(['cow', 'pig']).toContain(selectSpawn(candidates, { ...context, light: 15 }));
});

it('正式环境查询在暗处生成 hostile，peaceful 拒绝并进入快照', () => {
  const world = new GameplayRuntime({
    ...classicOptions(),
    platform: testCorePlatform,
    environmentSeed: 42,
    getWorldTime: () => 0,
    getVoxel: () => Voxel.Air,
    getLoadedVoxel: () => Voxel.Air,
    biomeAt: () => 'plains',
    prepareVoxelEdit: () => {
      throw new Error('unexpected');
    },
  });
  world.spawnPlayer({ id: 'player', position: [0, 1, 0] });
  expect(world.environmentQueries.attemptNaturalSpawn(candidates, [30, 1, 0], 100)).toMatchObject({
    success: true,
    entity: { type: 'creature' },
  });
  expect(world.createSnapshot().simulation.actors.some((actor) => actor.entityId.startsWith('natural-100-'))).toBe(
    true,
  );
  world.setDifficulty('peaceful', 0);
  expect(world.environmentQueries.attemptNaturalSpawn(candidates, [32, 1, 0], 101)).toEqual({
    success: false,
    reason: 'spawn-rejected',
  });
});

it('只有非持久且未驯服实体在128格外清退', () => {
  expect(shouldDespawnActor({}, 129)).toBe(true);
  expect(shouldDespawnActor({}, 128)).toBe(false);
  expect(shouldDespawnActor({ persistent: true }, 999)).toBe(false);
  expect(shouldDespawnActor({ tamed: true }, 999)).toBe(false);
});
