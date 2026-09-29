import { describe, expect, it } from 'vitest';
import { traceVoxelTarget } from '../../../src/client/presentation/voxel-target';

describe('体素目标统一射线', () => {
  it('命中首个障碍并返回进入面外邻格', () => {
    const get = (x: number, y: number, z: number) => (x === 0 && y === 2 && (z === -3 || z === -5) ? 3 : 0);
    expect(traceVoxelTarget([0.5, 2.5, 0.5], [0, 0, -1], get)).toMatchObject({
      position: [0, 2, -3],
      adjacent: [0, 2, -2],
      voxel: 3,
      inRange: true,
    });
  });
  it('按服务端体素中心5米边界，不把远目标作为可操作目标', () => {
    const get = (x: number, y: number, z: number) => (x === 0 && y === 2 && z === -5 ? 3 : 0);
    expect(traceVoxelTarget([0.5, 2.5, 0.5], [0, 0, -1], get)?.inRange).toBe(true);
    expect(traceVoxelTarget([0.5, 2.5, 0.501], [0, 0, -1], get)?.inRange).toBe(false);
  });
  it('负坐标边界稳定穿越，水不挡住固体，空处返回null', () => {
    const get = (x: number) => (x === -1 ? 8 : x === -2 ? 4 : 0);
    expect(traceVoxelTarget([0, 1.5, 0.5], [-1, 0, 0], get)).toMatchObject({ position: [-2, 1, 0], voxel: 4 });
    expect(traceVoxelTarget([0, 0, 0], [0, 1, 0], () => 0)).toBeNull();
  });
  it('把真实遍历cell坐标交给扩展predicate并命中该source cell', () => {
    const visited: string[] = [];
    const result = traceVoxelTarget(
      [0.5, 2.5, 0.5],
      [0, 0, -1],
      (_x, _y, z) => (z === -2 ? 8 : 0),
      (voxel, x, y, z) => {
        visited.push(`${voxel}@${x},${y},${z}`);
        return voxel === 8 && x === 0 && y === 2 && z === -2;
      },
    );

    expect(result).toMatchObject({ position: [0, 2, -2], voxel: 8 });
    expect(visited).toContain('8@0,2,-2');
  });
});
