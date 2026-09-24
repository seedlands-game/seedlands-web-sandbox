import { describe, expect, it } from 'vitest';
import { meshChunk } from '../../src/world/mesh';
import { CHUNK_SIZE, FaceMaterial, Voxel, voxelIndex } from '../../src/world/voxel';
import { createVoxelGeometryRegistryV1, type VoxelGeometryDefinitionV1 } from '../../src/world/voxel-geometry';
import { createMeshSemanticsLookup } from '../../src/world/mesh-semantics';
import type { VoxelSemanticsDefinition } from '../../src/world/voxel-semantics';

const storageId = 500;
const faces: VoxelSemanticsDefinition['faceMaterials'] = [
  FaceMaterial.WoodenDoor,
  FaceMaterial.WoodenDoor,
  FaceMaterial.WoodenDoor,
  FaceMaterial.WoodenDoor,
  FaceMaterial.WoodenDoor,
  FaceMaterial.WoodenDoor,
];
const semantics = createMeshSemanticsLookup([
  {
    id: 'sample:air',
    storageId: Voxel.Air,
    solid: false,
    targetable: false,
    renderable: false,
    meshKind: 'cube',
    emission: 0,
    lightCost: 1,
    faceMaterials: [
      FaceMaterial.Stone,
      FaceMaterial.Stone,
      FaceMaterial.Stone,
      FaceMaterial.Stone,
      FaceMaterial.Stone,
      FaceMaterial.Stone,
    ],
  },
  {
    id: 'sample:panel',
    storageId,
    solid: true,
    targetable: true,
    renderable: true,
    meshKind: 'cube',
    emission: 0,
    lightCost: 16,
    faceMaterials: faces,
  },
]);
const descriptor = (min: readonly [number, number, number], max: readonly [number, number, number], open = false) =>
  createVoxelGeometryRegistryV1([
    {
      version: 1,
      voxel: storageId,
      boxes: [{ min, max, material: FaceMaterial.WoodenDoor }],
      collision: open ? [] : [{ min, max }],
      occludesFullFace: false,
    } satisfies VoxelGeometryDefinitionV1,
  ]);
const mesh = (geometry: ReturnType<typeof descriptor>) => {
  const data = new Uint16Array(CHUNK_SIZE ** 3);
  data[voxelIndex(4, 5, 6)] = storageId;
  return meshChunk({ seed: 1, cx: 0, cy: 0, cz: 0, data, changes: [], outside: () => 0, semantics, geometry })[
    FaceMaterial.WoodenDoor
  ]!;
};

describe('registered voxel geometry meshing', () => {
  it('isolates the same storage id across compositions and emits registered positions, normals and UVs', () => {
    const first = mesh(descriptor([0.125, 0, 0], [0.25, 1, 1]));
    const second = mesh(descriptor([0.75, 0, 0], [0.875, 1, 1]));
    const firstX = [...first.positions].filter((_value, index) => index % 3 === 0);
    const secondX = [...second.positions].filter((_value, index) => index % 3 === 0);

    expect(new Set(firstX)).toEqual(new Set([4.125, 4.25]));
    expect(new Set(secondX)).toEqual(new Set([4.75, 4.875]));
    expect(first.normals).toHaveLength(first.positions.length);
    expect(first.uvs).toHaveLength((first.positions.length / 3) * 2);
    expect(first.indices).toHaveLength(36);
  });

  it('renders an open rotated thin box even when its collision projection is empty', () => {
    const open = mesh(descriptor([0, 0, 0.8125], [1, 1, 1], true));
    const zs = [...open.positions].filter((_value, index) => index % 3 === 2);

    expect(new Set(zs)).toEqual(new Set([6.8125, 7]));
    expect(open.indices).toHaveLength(36);
  });

  it('lets a registered descriptor override an existing static model without duplicate geometry', () => {
    const data = new Uint16Array(CHUNK_SIZE ** 3);
    data[voxelIndex(4, 5, 6)] = Voxel.WoodenDoor;
    const override = createVoxelGeometryRegistryV1([
      {
        version: 1,
        voxel: Voxel.WoodenDoor,
        boxes: [{ min: [0.75, 0, 0], max: [0.875, 1, 1], material: FaceMaterial.WoodenDoor }],
        collision: [{ min: [0.75, 0, 0], max: [0.875, 1, 1] }],
        occludesFullFace: false,
      },
    ]);
    const result = meshChunk({
      seed: 1,
      cx: 0,
      cy: 0,
      cz: 0,
      data,
      changes: [],
      outside: () => 0,
      geometry: override,
    })[FaceMaterial.WoodenDoor]!;
    const xs = [...result.positions].filter((_value, index) => index % 3 === 0);

    expect(new Set(xs)).toEqual(new Set([4.75, 4.875]));
    expect(result.indices).toHaveLength(36);
  });
});
