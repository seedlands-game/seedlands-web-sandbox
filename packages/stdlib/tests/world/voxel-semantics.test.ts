import { describe, expect, it } from 'vitest';
import { buildBlockLightVolume, sampleBlockLight } from '../../src/world/voxel-light';
import { createVoxelSemanticsRegistry } from '../../src/world/voxel-semantics';
import { overworldVoxelSemantics } from '../../../../playbooks/classic/src/blocks';
import { VoxelCollisionWorld } from '../../src/server/authority/voxel-collision-world';

describe('composed voxel semantics', () => {
  it('freezes namespace-qualified storage identities and supplies light semantics without a legacy switch', () => {
    const semantics = createVoxelSemanticsRegistry([
      {
        id: 'sample:glow-glass',
        storageId: 500,
        solid: false,
        targetable: true,
        renderable: true,
        meshKind: 'glass',
        emission: 15,
        lightCost: 1,
        faceMaterials: [21, 21, 21, 21, 21, 21],
      },
    ]);
    const volume = buildBlockLightVolume(
      5,
      [-2, -2, -2],
      (x, y, z) => (x === 0 && y === 0 && z === 0 ? 500 : 0),
      semantics,
    );

    expect(semantics.require(500)).toMatchObject({ id: 'sample:glow-glass', emission: 15, solid: false });
    expect(Object.isFrozen(semantics.require(500))).toBe(true);
    expect(sampleBlockLight(volume, 1, 0, 0)).toBe(14);
  });

  it('rejects duplicate or out-of-range numeric identities before a world freezes', () => {
    const base = {
      id: 'sample:block',
      storageId: 500,
      solid: true,
      targetable: true,
      renderable: true,
      meshKind: 'cube' as const,
      emission: 0,
      lightCost: 16,
      faceMaterials: [4, 4, 4, 4, 4, 4] as const,
      materialCategories: [[4, 'opaque']] as const,
    };
    expect(() => createVoxelSemanticsRegistry([base, { ...base, id: 'sample:other' }])).toThrow(/storage/i);
    expect(createVoxelSemanticsRegistry([{ ...base, storageId: 4_095 }]).require(4_095).storageId).toBe(4_095);
    expect(() => createVoxelSemanticsRegistry([{ ...base, storageId: 4_096 }])).toThrow(/storage/i);
  });

  it('registers every legacy Classic storage value without changing its light semantics', () => {
    const semantics = createVoxelSemanticsRegistry(overworldVoxelSemantics);
    expect(semantics.list()).toHaveLength(89);
    expect(semantics.list().map((entry) => entry.storageId)).toEqual(Array.from({ length: 89 }, (_, value) => value));
    expect(semantics.require(9)).toMatchObject({ id: 'seedlands:classic/glowstone', emission: 15, lightCost: 16 });
    expect(semantics.require(54)).toMatchObject({ id: 'seedlands:classic/torch', emission: 14, lightCost: 1 });
  });

  it('requires an explicit mesh kind for a composed renderable voxel', () => {
    expect(() =>
      createVoxelSemanticsRegistry([
        {
          id: 'sample:incomplete',
          storageId: 501,
          solid: true,
          targetable: true,
          renderable: true,
          emission: 0,
          lightCost: 16,
          faceMaterials: [4, 4, 4, 4, 4, 4],
        } as never,
      ]),
    ).toThrow(/mesh kind/i);
  });

  it('rejects face slots outside the fixed WebGL2 atlas and Pack model geometry without a registry', () => {
    const base = {
      id: 'sample:bounded',
      storageId: 500,
      solid: true,
      targetable: true,
      renderable: true,
      meshKind: 'cube' as const,
      emission: 0,
      lightCost: 16,
      faceMaterials: [4, 4, 4, 4, 4, 4] as const,
    };
    expect(() => createVoxelSemanticsRegistry([{ ...base, faceMaterials: [93, 93, 93, 93, 93, 93] } as never])).toThrow(
      /face material/i,
    );
    expect(() => createVoxelSemanticsRegistry([{ ...base, meshKind: 'model' }])).toThrow(/model geometry/i);
  });

  it('uses the composed solid flag for custom collision instead of legacy unknown-id behavior', () => {
    const definition = {
      id: 'sample:solid',
      storageId: 500,
      solid: true,
      targetable: true,
      renderable: true,
      meshKind: 'cube' as const,
      emission: 0,
      lightCost: 16,
      faceMaterials: [4, 4, 4, 4, 4, 4] as const,
    };
    const semantics = createVoxelSemanticsRegistry([definition]);
    const world = new VoxelCollisionWorld(
      { getLoadedVoxel: () => ({ voxel: 500, chunkKey: '0,0,0', revision: 0 }) },
      undefined,
      semantics,
    );
    expect(world.querySolids({ min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } })).toHaveLength(1);
  });
});
