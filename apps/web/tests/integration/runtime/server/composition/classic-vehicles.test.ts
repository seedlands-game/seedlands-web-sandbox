import { expect, it } from 'vitest';
import { GameplayRuntime, classicOptions } from '../../../../fixtures/classic/content';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { resolveRailShape } from '@seedlands/stdlib/server/gameplay/rail-runtime';
import { Voxel } from '@seedlands/stdlib/world/voxel';

const cells = new Map<string, number>([
  ['0,0,0', Voxel.PoweredRail],
  ['1,0,0', Voxel.DetectorRail],
  ['2,1,0', Voxel.Rail],
  ['0,0,4', Voxel.Water],
]);
const voxel = ([x, y, z]: [number, number, number]) =>
  cells.get([Math.floor(x), Math.floor(y), Math.floor(z)].join(',')) ?? Voxel.Air;
const createWorld = () => {
  const world = new GameplayRuntime({
    ...classicOptions(),
    platform: testCorePlatform,
    getWorldTime: () => 12,
    getVoxel: voxel,
    getLoadedVoxel: voxel,
    prepareVoxelEdit: () => {
      throw new Error('unexpected');
    },
  });
  world.spawnPlayer({ id: 'player', position: [0, 0, 0] });
  world.spawnAutonomous({ id: 'pig', archetype: 'pig', position: [1, 0, 0] }, { archetype: 'pig' });
  return world;
};

it('轨道连接和坡道只由已加载邻格确定', () => {
  expect(resolveRailShape([0, 0, 0], voxel)).toBe('east-west');
  expect(resolveRailShape([1, 0, 0], voxel)).toBe('ascending-east');
  expect(resolveRailShape([8, 0, 0], () => undefined)).toBeNull();
});

it('矿车在动力轨推进并同步乘员，安全下车且可恢复', () => {
  const world = createWorld();
  const spawned = world.vehicles.spawn('minecart', [0, 0, 0]);
  expect(spawned).toMatchObject({ success: true, vehicle: { id: 'vehicle-1' } });
  expect(world.vehicles.mount('player', 'vehicle-1')).toEqual({ success: true });
  expect(world.vehicles.setMotion('vehicle-1', 1, [1, 0])).toEqual({ success: true });
  world.vehicles.advance(0.25);
  expect(world.getEntity('player')!.position[0]).toBeGreaterThan(0);
  expect(world.vehicles.detectorActive([1, 0, 0])).toBe(true);
  const restored = createWorld();
  restored.restoreSnapshot(world.createSnapshot());
  expect(restored.vehicles.list()[0]).toMatchObject({ id: 'vehicle-1', riderId: 'player' });
  expect(restored.vehicles.dismount('player')).toMatchObject({ success: true });
  const invalid = structuredClone(world.createSnapshot());
  invalid.vehicles!.vehicles[0] = { ...invalid.vehicles!.vehicles[0], riderId: 'missing-player' };
  expect(() => createWorld().restoreSnapshot(invalid)).toThrow(/Vehicle rider/);
});

it('船只接受水面且箱车有固定27格库存', () => {
  const world = createWorld();
  expect(world.vehicles.spawn('boat', [0, 0, 4])).toMatchObject({ success: true, vehicle: { kind: 'boat' } });
  expect(world.vehicles.spawn('chest-minecart', [0, 0, 0])).toMatchObject({
    success: true,
    vehicle: { inventory: expect.arrayContaining([]) },
  });
  expect(world.vehicles.list().find((vehicle) => vehicle.kind === 'chest-minecart')!.inventory).toHaveLength(27);
  const furnace = world.vehicles.spawn('furnace-minecart', [0, 0, 0]);
  expect(furnace).toMatchObject({ success: true });
  expect(world.vehicles.fuel(furnace.vehicle!.id, 10)).toEqual({ success: true });
});

it('鞍猪原子扣除鞍并复用乘坐位置 owner', () => {
  const world = createWorld();
  world.giveItem('player', { itemId: 'saddle', count: 1 });
  expect(world.vehicles.saddlePig('player', 'pig')).toEqual({ success: true, vehicleId: 'pig:pig' });
  expect(world.getInventory('player').slots.every((stack) => stack?.itemId !== 'saddle')).toBe(true);
  expect(world.vehicles.mount('player', 'pig:pig')).toEqual({ success: true });
  expect(world.vehicles.setMotion('pig:pig', 2, [1, 0])).toEqual({ success: true });
  world.vehicles.advance(0.5);
  expect(world.getEntity('pig')!.position).toEqual(world.getEntity('player')!.position);
});
