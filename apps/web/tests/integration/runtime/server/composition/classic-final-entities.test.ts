import { beforeEach, expect, it } from 'vitest';
import { GameplayRuntime, classicOptions } from '../../../../fixtures/classic/content';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { Voxel } from '@seedlands/stdlib/world/voxel';

const cells = new Map<string, number>();
beforeEach(() => cells.clear());
const createWorld = () => {
  const world = new GameplayRuntime({
    ...classicOptions(),
    platform: testCorePlatform,
    environmentSeed: 19,
    getWorldTime: () => 20,
    getVoxel: ([x, y, z]) => cells.get(`${x},${y},${z}`) ?? Voxel.Air,
    getLoadedVoxel: ([x, y, z]) => cells.get(`${x},${y},${z}`) ?? Voxel.Air,
    prepareVoxelEdit: () => {
      throw new Error('unexpected');
    },
    editBatch: ({ edits }) => {
      for (const edit of edits) cells.set(`${edit.x},${edit.y},${edit.z}`, edit.value);
      return { committed: true, worldRevision: 1, changedChunks: [] } as never;
    },
  });
  world.spawnPlayer({ id: 'player', position: [0, 0, 0] });
  return world;
};

it('雪球复用投射物 owner 并原子扣除物品', () => {
  const world = createWorld();
  world.giveItem('player', { itemId: 'snowball', count: 2 });
  expect(world.finalEntities.throwSnowball('player', { x: 1, y: 0, z: 0 })).toMatchObject({ success: true });
  expect(world.projectiles.list()).toHaveLength(1);
  expect(world.getInventory('player').slots.find((s) => s?.itemId === 'snowball')?.count).toBe(1);
});

it('闪电点火、伤害并把猪转换为 pig-zombie，状态可恢复', () => {
  const world = createWorld();
  world.spawnAutonomous({ id: 'pig', archetype: 'pig', position: [2, 0, 0] }, { archetype: 'pig' });
  world.environment.setWeather('thunder', 30);
  expect(world.finalEntities.strikeLightning([2, 0, 0])).toMatchObject({ success: true });
  expect(world.getPlayerState('player').health).toBe(15);
  expect(world.getEntity('pig')).toBeNull();
  expect(world.getEntity('lightning-1:pig')?.archetype).toBe('pig-zombie');
  expect(world.environment.checkpoint().lightning).toHaveLength(1);
  const restored = createWorld();
  restored.restoreSnapshot(world.createSnapshot());
  expect(restored.getEntity('lightning-1:pig')?.archetype).toBe('pig-zombie');
  expect(restored.environment.checkpoint().lightning).toHaveLength(1);
});

it('闪电拒绝非雷雨和被遮挡位置，多个猪获得唯一转换身份', () => {
  const world = createWorld();
  world.spawnAutonomous({ id: 'pig-a', archetype: 'pig', position: [2, 0, 0] }, { archetype: 'pig' });
  world.spawnAutonomous({ id: 'pig-b', archetype: 'pig', position: [3, 0, 0] }, { archetype: 'pig' });
  expect(world.finalEntities.strikeLightning([2, 0, 0])).toEqual({
    success: false,
    reason: 'lightning-unavailable',
  });
  world.environment.setWeather('thunder', 30);
  cells.set('2,3,0', Voxel.Stone);
  expect(world.finalEntities.strikeLightning([2, 0, 0])).toMatchObject({ success: false });
  cells.delete('2,3,0');
  expect(world.finalEntities.strikeLightning([2, 0, 0])).toMatchObject({ success: true });
  expect(world.getEntity('lightning-1:pig-a')?.archetype).toBe('pig-zombie');
  expect(world.getEntity('lightning-1:pig-b')?.archetype).toBe('pig-zombie');
});

it('下落方块落地和画支撑失效均由明确 owner 结算', () => {
  const world = createWorld();
  cells.set('3,0,0', Voxel.Stone);
  cells.set('3,2,0', Voxel.Sand);
  cells.set('4,0,0', Voxel.Stone);
  expect(world.finalEntities.spawnFallingSand([3, 2, 0], Voxel.Sand)).toMatchObject({ success: true });
  expect(cells.get('3,2,0')).toBe(Voxel.Air);
  expect(world.queryEntities({ type: 'falling-block' })).toHaveLength(1);
  world.finalEntities.advance(2);
  expect(cells.get('3,1,0')).toBe(Voxel.Sand);
  world.giveItem('player', { itemId: 'painting', count: 1 });
  expect(world.finalEntities.placePainting('player', [4, 0, 0])).toMatchObject({ success: true });
  expect(world.queryEntities({ type: 'painting' })).toHaveLength(1);
  const restored = createWorld();
  restored.restoreSnapshot(world.createSnapshot());
  expect(restored.queryEntities({ type: 'painting' })).toHaveLength(1);
  cells.set('4,0,0', Voxel.Air);
  world.finalEntities.advance(1);
  expect(world.queryEntities({ type: 'world-item' }).some((entity) => entity.stack?.itemId === 'painting')).toBe(true);
});
