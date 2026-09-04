import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, FaceMaterial, Voxel, normalizeSeed, voxelIndex } from '../../src/world/voxel';
import { createProceduralMeshInput, makeChunk, meshChunk } from '../../src/world/mesh';

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

  it('derives a deterministic one-voxel halo and gives authority overlays precedence', () => {
    const generated = createProceduralMeshInput({ seed, cx: 0, cy: 0, cz: 0 });
    const overridden = createProceduralMeshInput({
      seed,
      cx: 0,
      cy: 0,
      cz: 0,
      overlays: [{ cx: 1, cy: 0, cz: 0, voxels: new Uint16Array(CHUNK_SIZE ** 3).fill(Voxel.Air) }],
    });

    expect(generated.canonical).toEqual(makeChunk(seed, 0, 0, 0, []));
    expect(generated.halo).toHaveLength(34 ** 3);
    expect(generated.haloRevision).toMatch(/^\d+$/);
    expect(overridden.halo).not.toEqual(generated.halo);
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

  it('maps grass and wood faces to their directional materials', () => {
    const grass = meshSynthetic([[4, 4, 4, Voxel.Grass]]);
    expect(grass[FaceMaterial.GrassTop].indices).toHaveLength(6);
    expect(grass[FaceMaterial.GrassSide].indices).toHaveLength(24);
    expect(grass[FaceMaterial.Dirt].indices).toHaveLength(6);

    const wood = meshSynthetic([[4, 4, 4, Voxel.Wood]]);
    expect(wood[FaceMaterial.WoodEnd].indices).toHaveLength(12);
    expect(wood[FaceMaterial.WoodSide].indices).toHaveLength(24);
  });

  it('keeps every vertical block side texture upright', () => {
    const wood = meshSynthetic([[4, 4, 4, Voxel.Wood]])[FaceMaterial.WoodSide];

    for (let vertex = 0; vertex < wood.positions.length / 3; vertex += 1) {
      const worldY = wood.positions[vertex * 3 + 1];
      const textureV = wood.uvs[vertex * 2 + 1];
      expect(textureV).toBe(worldY - 4);
    }
  });

  it('emits repeating UVs and AO vertex colors with a typed worker contract', () => {
    const meshes = meshSynthetic([
      [4, 4, 4, Voxel.Stone],
      [5, 4, 4, Voxel.Stone],
      [3, 5, 4, Voxel.Stone],
      [4, 5, 3, Voxel.Stone],
      [3, 5, 3, Voxel.Stone],
    ]);
    const stone = meshes[FaceMaterial.Stone];
    expect(Math.max(...stone.uvs)).toBeGreaterThan(1);
    expect(Math.min(...stone.colors)).toBeLessThan(255);
    expect(stone.uvs).toHaveLength((stone.positions.length / 3) * 2);
    expect(stone.colors).toHaveLength((stone.positions.length / 3) * 4);
    expect(stone.material).toBe(FaceMaterial.Stone);
    expect(stone.renderLayer).toBe('opaque');
  });

  it('keeps opaque banks visible through water and removes internal water faces', () => {
    const bank = meshSynthetic([
      [4, 4, 4, Voxel.Stone],
      [5, 4, 4, Voxel.Water],
    ]);
    expect(bank[FaceMaterial.Stone].indices).toHaveLength(36);
    expect(bank[FaceMaterial.Water].indices).toHaveLength(30);
    expect(bank[FaceMaterial.Water].renderLayer).toBe('water');
    expect(sumIndices(bank)).toBe(66);

    const water = meshSynthetic([
      [4, 4, 4, Voxel.Water],
      [5, 4, 4, Voxel.Water],
    ]);
    expect(water[FaceMaterial.Water].indices).toHaveLength(36);
  });
});
