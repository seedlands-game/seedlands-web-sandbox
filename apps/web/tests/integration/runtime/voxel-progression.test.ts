import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { makeChunk } from '../../../../../packages/stdlib/src/world/chunk-generation';
import { meshChunk } from '../../../../../packages/stdlib/src/world/mesh';
import {
  FaceMaterial,
  GENERATOR_VERSION,
  MAX_VOXEL_ID,
  Voxel,
  faceMaterialFor,
} from '../../../../../packages/stdlib/src/world/voxel';
import { makeChunkStaged } from '../../../src/compute/chunk-kernel';
import { MATERIAL_LAYER_COUNT } from '../../../src/app/scene/voxel-render-pipeline';
import { builtinTerrainTextures, terrainMaterials } from '../../../src/client/presentation/terrain-assets';

function chunkSha256(chunk: Uint16Array): string {
  const bytes = Buffer.allocUnsafe(chunk.byteLength);
  for (let index = 0; index < chunk.length; index += 1) bytes.writeUInt16LE(chunk[index], index * 2);
  return createHash('sha256').update(bytes).digest('hex');
}

describe('S4 voxel progression palette', () => {
  it('freezes generator 2/3 chunk bytes before V4 ore changes', () => {
    const samples = [
      {
        version: 2,
        seed: 1,
        chunk: [13, 0, -2] as const,
        hash: 'ceb78fb4f2bc61516c3d9da5bbf462ce99924c5be92d182e83bd266a28d7630f',
      },
      {
        version: 2,
        seed: 0xffffffff,
        chunk: [-2, -1, 3] as const,
        hash: 'fe07de53df8de446f773579f14a3b4dd16d9f584f6aa8f41f71a74047a29f6e8',
      },
      {
        version: 3,
        seed: 1,
        chunk: [13, 0, -2] as const,
        hash: 'b9ba748cdea5ab7fc28ae7c47ce332bc353e7ab2e74c195c3d1a2d27437456c0',
      },
      {
        version: 3,
        seed: 0xffffffff,
        chunk: [-2, -1, 3] as const,
        hash: 'fe07de53df8de446f773579f14a3b4dd16d9f584f6aa8f41f71a74047a29f6e8',
      },
    ];
    expect(
      samples.map((sample) => {
        const [cx, cy, cz] = sample.chunk;
        return chunkSha256(makeChunk(sample.seed, cx, cy, cz, [], sample.version));
      }),
    ).toEqual(samples.map((sample) => sample.hash));
  });

  it('assigns stable IDs and complete full-cube materials to the five new voxels', () => {
    expect(GENERATOR_VERSION).toBe(4);
    expect(MAX_VOXEL_ID).toBe(Voxel.IronOre);
    expect([Voxel.Workbench, Voxel.Chest, Voxel.Furnace, Voxel.CoalOre, Voxel.IronOre]).toEqual([11, 12, 13, 14, 15]);
    expect([
      FaceMaterial.Workbench,
      FaceMaterial.Chest,
      FaceMaterial.Furnace,
      FaceMaterial.CoalOre,
      FaceMaterial.IronOre,
    ]).toEqual([14, 15, 16, 17, 18]);
    expect([
      faceMaterialFor(Voxel.Workbench, 0, true),
      faceMaterialFor(Voxel.Chest, 1, true),
      faceMaterialFor(Voxel.Furnace, 2, false),
      faceMaterialFor(Voxel.CoalOre, 0, false),
      faceMaterialFor(Voxel.IronOre, 1, false),
    ]).toEqual([14, 15, 16, 17, 18]);
    expect(MATERIAL_LAYER_COUNT).toBe(18);
    expect(terrainMaterials).toHaveLength(18);
    expect(builtinTerrainTextures).toHaveLength(18);
    for (const [material, textureName] of [
      [FaceMaterial.Workbench, 'workbench'],
      [FaceMaterial.Chest, 'chest'],
      [FaceMaterial.Furnace, 'furnace'],
      [FaceMaterial.CoalOre, 'coal-ore'],
      [FaceMaterial.IronOre, 'iron-ore'],
    ] as const) {
      const texture = builtinTerrainTextures.find((candidate) => candidate.id.endsWith(`/${textureName}`));
      expect(texture).toBeDefined();
      expect(terrainMaterials.find((candidate) => candidate.faceMaterial === material)?.textureId).toBe(texture?.id);
    }
    const signatures = builtinTerrainTextures
      .slice(-5)
      .map((texture) => createHash('sha256').update(Uint8Array.from(texture.payload.pixels)).digest('hex'));
    expect(new Set(signatures).size).toBe(5);
  });

  it('keeps the staged path byte-identical for versions 2, 3, and 4', () => {
    for (const version of [2, 3, 4])
      for (const [cx, cy, cz] of [
        [0, 0, 0],
        [-2, -1, 3],
      ] as const)
        expect(makeChunkStaged(1837, cx, cy, cz, [], version)).toEqual(makeChunk(1837, cx, cy, cz, [], version));
  });

  it('meshes every new voxel through its assigned material', () => {
    const expected = [
      [Voxel.Workbench, FaceMaterial.Workbench],
      [Voxel.Chest, FaceMaterial.Chest],
      [Voxel.Furnace, FaceMaterial.Furnace],
      [Voxel.CoalOre, FaceMaterial.CoalOre],
      [Voxel.IronOre, FaceMaterial.IronOre],
    ] as const;
    for (const [voxel, material] of expected) {
      const data = new Uint16Array(32 ** 3);
      data[0] = voxel;
      const meshes = meshChunk({ seed: 1, cx: 0, cy: 0, cz: 0, data, changes: [], outside: () => Voxel.Air });
      expect(Object.keys(meshes).map(Number)).toEqual([material]);
      expect(meshes[material].indices.length).toBe(36);
    }
  });
});
