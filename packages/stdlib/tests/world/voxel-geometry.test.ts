import { describe, expect, it } from 'vitest';
import { assembleWorldPacks, type VerifiedPackArtifact } from '../../src/server/composition/host-api';
import { definePack } from '../../src/server/composition/assembly';
import { defineContentModule } from '../../src/server/gameplay/modules/content-module';
import {
  VOXEL_GEOMETRY_CAPABILITY,
  defineVoxelGeometryModule,
} from '../../src/server/gameplay/modules/voxel-geometry-module';
import {
  createVoxelGeometryRegistryV1,
  type VoxelGeometryDefinitionV1,
  type VoxelGeometryRegistryV1,
} from '../../src/world/voxel-geometry';
import { FaceMaterial } from '../../src/world/voxel';

const box = (minimum = 0.125, maximum = 0.875) => ({
  min: [minimum, 0, 0] as const,
  max: [maximum, 1, 1] as const,
});

const geometry = (voxel = 500, minimum = 0.125): VoxelGeometryDefinitionV1 => ({
  version: 1,
  voxel,
  boxes: [{ ...box(minimum, minimum + 0.125), material: FaceMaterial.WoodenDoor }],
  collision: [box(minimum, minimum + 0.125)],
  occludesFullFace: false,
});

const content = (moduleId: string, voxel = 500) =>
  defineContentModule({
    moduleId,
    items: [],
    meleeDefinitions: [],
    voxels: [
      {
        id: `${moduleId}/panel`,
        storageId: voxel,
        solid: true,
        targetable: true,
        renderable: true,
        meshKind: 'cube',
        emission: 0,
        lightCost: 16,
        faceMaterials: [
          FaceMaterial.WoodenDoor,
          FaceMaterial.WoodenDoor,
          FaceMaterial.WoodenDoor,
          FaceMaterial.WoodenDoor,
          FaceMaterial.WoodenDoor,
          FaceMaterial.WoodenDoor,
        ],
      },
    ],
  });

const artifact = (id: string, minimum: number, voxel = 500): VerifiedPackArtifact => {
  const pack = definePack({
    id,
    version: '1.0.0',
    kind: 'playbook',
    modules: [
      content(`${id}-content`, 500),
      defineVoxelGeometryModule({ moduleId: `${id}-geometry`, descriptors: [geometry(voxel, minimum)] }),
    ],
  });
  return {
    ...pack,
    integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
  };
};

describe('VoxelGeometryRegistryV1', () => {
  it('deep-freezes a detached getter and serializable projection', () => {
    const source = geometry();
    const registry = createVoxelGeometryRegistryV1([source]);
    const descriptor = registry.require(500);

    expect(registry.get(500)).toBe(descriptor);
    expect(registry.get(501)).toBeUndefined();
    expect(registry.list()).toEqual([descriptor]);
    expect(JSON.parse(JSON.stringify(registry.list()))).toEqual(registry.list());
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.list())).toBe(true);
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor.boxes)).toBe(true);
    expect(Object.isFrozen(descriptor.boxes[0])).toBe(true);
    expect(Object.isFrozen(descriptor.boxes[0]!.min)).toBe(true);
    expect(Object.isFrozen(descriptor.collision)).toBe(true);
    expect(Object.isFrozen(descriptor.collision[0]!.max)).toBe(true);
    (source.boxes[0]!.min as unknown as number[])[0] = 0.5;
    expect(descriptor.boxes[0]!.min[0]).toBe(0.125);
    expect(() => registry.require(501)).toThrow(/geometry.*501/i);
  });

  it('rejects duplicate voxels, unknown materials and invalid finite bounded boxes', () => {
    expect(() => createVoxelGeometryRegistryV1([geometry(), geometry()])).toThrow(/duplicate.*500/i);
    expect(() =>
      createVoxelGeometryRegistryV1([{ ...geometry(), boxes: [{ ...box(), material: 4_096 as never }] }]),
    ).toThrow(/material/i);
    for (const invalid of [
      { min: [Number.NaN, 0, 0], max: [1, 1, 1] },
      { min: [-0.01, 0, 0], max: [1, 1, 1] },
      { min: [0, 0, 0], max: [1.01, 1, 1] },
      { min: [0.5, 0, 0], max: [0.5, 1, 1] },
    ])
      expect(() =>
        createVoxelGeometryRegistryV1([
          { ...geometry(), boxes: [{ ...invalid, material: FaceMaterial.WoodenDoor }] as never },
        ]),
      ).toThrow(/box/i);
  });

  it('rejects sparse or extended descriptor and box arrays', () => {
    const sparse = new Array<VoxelGeometryDefinitionV1>(2);
    sparse[1] = geometry();
    expect(() => createVoxelGeometryRegistryV1(sparse)).toThrow(/dense/i);

    const extended = [geometry()] as VoxelGeometryDefinitionV1[] & { extra?: VoxelGeometryDefinitionV1 };
    extended.extra = geometry(501);
    expect(() => createVoxelGeometryRegistryV1(extended)).toThrow(/extra/i);

    const sparseBoxes = new Array<ReturnType<typeof box> & { material: typeof FaceMaterial.WoodenDoor }>(2);
    sparseBoxes[1] = { ...box(), material: FaceMaterial.WoodenDoor };
    expect(() => createVoxelGeometryRegistryV1([{ ...geometry(), boxes: sparseBoxes }])).toThrow(/dense/i);
  });

  it('isolates identical storage ids across compositions without global reconfiguration', () => {
    const first = assembleWorldPacks([artifact('sample:first-geometry-world', 0.125)]);
    const second = assembleWorldPacks([artifact('sample:second-geometry-world', 0.75)]);
    const firstRegistry = first.capability<VoxelGeometryRegistryV1>(VOXEL_GEOMETRY_CAPABILITY);
    const secondRegistry = second.capability<VoxelGeometryRegistryV1>(VOXEL_GEOMETRY_CAPABILITY);

    expect(firstRegistry).not.toBe(secondRegistry);
    expect(firstRegistry.require(500).boxes[0]!.min[0]).toBe(0.125);
    expect(secondRegistry.require(500).boxes[0]!.min[0]).toBe(0.75);
    expect(firstRegistry.require(500).boxes[0]!.min[0]).toBe(0.125);
  });

  it('rejects geometry for an unknown voxel or material outside that voxel semantics', () => {
    expect(() => assembleWorldPacks([artifact('sample:unknown-geometry-world', 0.125, 501)])).toThrow(
      /geometry voxel.*501.*not registered/i,
    );
    const descriptor = {
      ...geometry(),
      boxes: [{ ...box(), material: FaceMaterial.Stone }],
    };
    const pack = definePack({
      id: 'sample:unknown-material-world',
      version: '1.0.0',
      kind: 'playbook',
      modules: [
        content('sample:unknown-material-content'),
        defineVoxelGeometryModule({ moduleId: 'sample:unknown-material-geometry', descriptors: [descriptor] }),
      ],
    });
    expect(() =>
      assembleWorldPacks([
        {
          ...pack,
          integrity: {
            algorithm: 'sha256',
            manifestDigest: 'a'.repeat(64),
            entryDigest: 'b'.repeat(64),
            resources: [],
          },
        },
      ]),
    ).toThrow(/geometry material.*not registered.*voxel/i);

    const collisionPack = definePack({
      id: 'sample:collision-mismatch-world',
      version: '1.0.0',
      kind: 'playbook',
      modules: [
        content('sample:collision-mismatch-content'),
        defineVoxelGeometryModule({
          moduleId: 'sample:collision-mismatch-geometry',
          descriptors: [{ ...geometry(), collision: [] }],
        }),
      ],
    });
    expect(() =>
      assembleWorldPacks([
        {
          ...collisionPack,
          integrity: {
            algorithm: 'sha256',
            manifestDigest: 'a'.repeat(64),
            entryDigest: 'b'.repeat(64),
            resources: [],
          },
        },
      ]),
    ).toThrow(/collision.*semantics/i);
  });
});
