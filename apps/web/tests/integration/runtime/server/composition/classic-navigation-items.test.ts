import { expect, it } from 'vitest';
import { GameplayRuntime, classicContent } from '../../../../fixtures/classic/content';
import { classicGameplayDomainOptions } from './classic-gameplay-domain-options';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { Voxel } from '@seedlands/stdlib/world/voxel';

let worldTime = 6;
const loaded = ([x, y, z]: [number, number, number]) =>
  Math.abs(x) <= 8 && y === 4 && Math.abs(z) <= 8 ? ((x + z) % 2 ? Voxel.Grass : Voxel.Stone) : undefined;
const createWorld = () => {
  const world = new GameplayRuntime({
    ...classicGameplayDomainOptions(),
    platform: testCorePlatform,
    environmentSeed: 7,
    getWorldTime: () => worldTime,
    getVoxel: loaded,
    getLoadedVoxel: loaded,
    prepareVoxelEdit: () => {
      throw new Error('unexpected');
    },
  });
  world.spawnPlayer({ id: 'player', position: [4, 4, 0] });
  return world;
};

it('注册指南针、时钟、地图及纸和红石配方闭包', () => {
  for (const id of ['paper', 'redstone-dust', 'compass', 'clock', 'map'])
    expect(classicContent.items.has(id)).toBe(true);
  for (const id of ['paper', 'compass', 'clock', 'map']) expect(classicContent.recipes.get(id)?.id).toBe(id);
});

it('指南针指向保存的出生点，时钟相位按主世界时间环绕', () => {
  const world = createWorld();
  expect(world.navigationItems.compass('player')).toMatchObject({ target: [4, 4, 0], turns: 0 });
  world.updateEntity('player', { position: [4, 4, 4] });
  expect(world.navigationItems.compass('player').turns).toBeCloseTo(0.75);
  expect(world.navigationItems.clock()).toEqual({ worldTime: 6, phase: 0.25 });
  worldTime = 30;
  expect(world.navigationItems.clock()).toEqual({ worldTime: 30, phase: 0.25 });
  worldTime = 6;
});

it('地图只由已加载体素更新，缩放和像素可保存恢复', () => {
  const world = createWorld();
  world.giveItem('player', { itemId: 'map', count: 1 });
  expect(world.navigationItems.explore('player', 1)).toMatchObject({ success: true, map: { id: 'map-1', scale: 1 } });
  const map = world.navigationItems.list()[0]!;
  expect(map.pixels.length).toBeGreaterThan(0);
  expect(map.pixels.every((pixel) => Math.abs(pixel.x) <= 4 && Math.abs(pixel.z) <= 4)).toBe(true);
  const restored = createWorld();
  restored.restoreSnapshot(world.createSnapshot());
  expect(restored.navigationItems.list()).toEqual(world.navigationItems.list());

  const malformed = structuredClone(world.createSnapshot());
  malformed.navigationItems!.maps[0]!.pixels.push({ x: 0, z: 0, color: 999 });
  expect(() => createWorld().restoreSnapshot(malformed)).toThrow(/Navigation map/);
  const missingPlayer = structuredClone(world.createSnapshot());
  missingPlayer.navigationItems!.maps[0]!.playerId = 'missing-player';
  expect(() => createWorld().restoreSnapshot(missingPlayer)).toThrow(/Navigation map player/);
});
