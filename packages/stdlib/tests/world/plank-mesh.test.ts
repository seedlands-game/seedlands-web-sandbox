import { expect, it } from 'vitest';
import { meshChunk } from '../../src/world/mesh';
import { isSolid, faceMaterialFor, voxelIndex } from '../../src/world/voxel';

it('木板全立方体使用独立材料，邻接面剔除且可碰撞', () => {
  const data = new Uint16Array(32 ** 3);
  data[voxelIndex(4, 4, 4)] = 16;
  data[voxelIndex(5, 4, 4)] = 16;
  expect(isSolid(16)).toBe(true);
  expect(faceMaterialFor(16, 1, true)).toBe(19);
  const meshes = meshChunk({ seed: 1, cx: 0, cy: 0, cz: 0, data, changes: [], outside: () => 0 });
  expect(Object.keys(meshes)).toEqual(['19']);
  expect(meshes[19].indices).toHaveLength(36);
});
