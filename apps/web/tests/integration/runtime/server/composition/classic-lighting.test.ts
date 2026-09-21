import { expect, it } from 'vitest';
import { daylightLevel, sampleLight } from '@seedlands/stdlib/server/gameplay/light-sampler';
import { Voxel } from '@seedlands/stdlib/world/voxel';

it('昼夜天空光曲线稳定且遮挡归零', () => {
  expect(daylightLevel(12)).toBe(15);
  expect(daylightLevel(0)).toBe(0);
  expect(daylightLevel(24)).toBe(0);
  expect(sampleLight([0, 10, 0], 12, () => Voxel.Air)).toEqual({ sky: 15, block: 0, level: 15 });
  expect(sampleLight([0, 10, 0], 12, ([, y]) => (y === 12 ? Voxel.Stone : Voxel.Air))).toEqual({
    sky: 0,
    block: 0,
    level: 0,
  });
  expect(sampleLight([0, 10, 0], 12, ([, y]) => (y === 12 ? undefined : Voxel.Air))).toBeNull();
});

it('方块光按距离衰减并在方块变更后立即更新', () => {
  const cells = new Map<string, number>([['2,10,0', Voxel.Lantern]]);
  const get = (p: readonly number[]) => cells.get(p.join(',')) ?? Voxel.Air;
  expect(sampleLight([0, 10, 0], 0, get)).toEqual({ sky: 0, block: 12, level: 12 });
  cells.delete('2,10,0');
  cells.set('1,10,0', Voxel.Fire);
  expect(sampleLight([0, 10, 0], 0, get)?.block).toBe(14);
});
