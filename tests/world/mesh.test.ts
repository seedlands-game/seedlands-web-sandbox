import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, Voxel, normalizeSeed, voxelIndex } from '../../src/world/voxel';
import { makeChunk, meshChunk } from '../../src/world/mesh';

const seed = normalizeSeed('vitest-world-mesh');

function meshSynthetic(voxels: readonly (readonly [number, number, number, number])[]) {
  const data = new Uint16Array(CHUNK_SIZE ** 3);
  for (const [x, y, z, value] of voxels) data[voxelIndex(x, y, z)] = value;
  return meshChunk({ seed, cx: 0, cy: 3, cz: 0, data, changes: [], outside: () => Voxel.Air });
}

function sumIndices(meshes: Record<number, { indices: Uint32Array }>) {
  return Object.values(meshes).reduce((sum, mesh) => sum + mesh.indices.length, 0);
}

describe('chunk generation', () => {
  it('is stable for positive and negative chunk coordinates', () => {
    for (const [cx, cy, cz] of [
      [-2, 0, 1],
      [0, 1, 0],
      [3, 0, -4],
    ]) {
      expect(makeChunk(seed, cx, cy, cz, [])).toEqual(makeChunk(seed, cx, cy, cz, []));
    }
  });

  it('applies changes to their negative-coordinate local positions', () => {
    const data = makeChunk(seed, -2, 0, 1, [[-33, 20, 32, Voxel.Wood]]);

    expect(data[voxelIndex(31, 20, 0)]).toBe(Voxel.Wood);
  });
});

describe('greedy chunk meshing', () => {
  it.each([
    ['empty chunks', [], 0],
    ['one voxel', [[0, 0, 0, Voxel.Stone]], 36],
    [
      'adjacent same-material voxels',
      [
        [0, 0, 0, Voxel.Stone],
        [1, 0, 0, Voxel.Stone],
      ],
      36,
    ],
    [
      'adjacent mixed-material voxels',
      [
        [0, 0, 0, Voxel.Stone],
        [1, 0, 0, Voxel.Dirt],
      ],
      60,
    ],
    ['a chunk-edge voxel', [[31, 31, 31, Voxel.Stone]], 36],
  ] as const)('creates the expected geometry for %s', (_caseName, voxels, expectedIndices) => {
    expect(sumIndices(meshSynthetic(voxels))).toBe(expectedIndices);
  });

  it('reduces a solid chunk to six quads', () => {
    const data = new Uint16Array(CHUNK_SIZE ** 3).fill(Voxel.Stone);
    const meshes = meshChunk({ seed, cx: 0, cy: 3, cz: 0, data, changes: [], outside: () => Voxel.Air });

    expect(sumIndices(meshes)).toBe(36);
  });
});
