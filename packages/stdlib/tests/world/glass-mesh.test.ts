import { expect, it } from 'vitest';
import { meshChunk } from '../../src/world/mesh';
import { collisionBoxesForVoxel, voxelOccludesFullFace } from '../../src/world/voxel-model';
import { voxelIndex } from '../../src/world/voxel';

it('玻璃保持碰撞，不遮住后方石面，相邻玻璃不生成内部面', () => {
  const data = new Uint16Array(32 ** 3);
  data[voxelIndex(4, 4, 4)] = 18;
  data[voxelIndex(5, 4, 4)] = 18;
  expect(collisionBoxesForVoxel(18)).toHaveLength(1);
  expect(voxelOccludesFullFace(18)).toBe(false);
  const options = { seed: 1, cx: 0, cy: 0, cz: 0, data, changes: [], outside: () => 0 };
  const glass = meshChunk(options);
  expect(glass[21].renderCategory).toBe('cutout');
  expect(glass[21].indices).toHaveLength(36);
  data[voxelIndex(5, 4, 4)] = 3;
  const mixed = meshChunk(options);
  expect(mixed[4].indices).toHaveLength(36);
  expect(mixed[21].indices).toHaveLength(30);
});
