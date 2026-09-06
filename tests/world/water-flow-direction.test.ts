import { describe, expect, it } from 'vitest';
import { sampleWaterFlowDirection } from '../../src/world/water-flow-direction';
import { Voxel } from '../../src/world/voxel';

describe('水面流向采样', () => {
  it('朝向更低水位的相邻单元并归一化', () => {
    const levels = new Map([
      ['0,0', 8],
      ['1,0', 5],
      ['-1,0', 7],
      ['0,1', 7],
      ['0,-1', 7],
    ]);
    const direction = sampleWaterFlowDirection(0, 2, 0, {
      getVoxel: (x, _y, z) => (levels.has(`${x},${z}`) ? Voxel.Water : Voxel.Air),
      getFluidLevel: (x, _y, z) => levels.get(`${x},${z}`) ?? null,
    });
    expect(direction[0]).toBeGreaterThan(0.9);
    expect(Math.abs(direction[1])).toBeLessThan(0.1);
  });

  it('静水返回零向量', () => {
    expect(
      sampleWaterFlowDirection(0, 2, 0, {
        getVoxel: () => Voxel.Water,
        getFluidLevel: () => 8,
      }),
    ).toEqual([0, 0]);
  });
});
