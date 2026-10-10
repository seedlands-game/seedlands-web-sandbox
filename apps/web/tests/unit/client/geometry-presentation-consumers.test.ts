import { describe, expect, it } from 'vitest';
import { FaceMaterial } from '../../../../../packages/stdlib/src/world/voxel';
import { createVoxelGeometryRegistryV1 } from '../../../../../packages/stdlib/src/world/voxel-geometry';
import { itemMeshDefinition } from '../../../src/client/presentation/item-mesh-definition';
import { createCollisionDebugBatch } from '../../../src/client/presentation/collision-debug-projection';

const geometry = (minimum: number, collision = true) =>
  createVoxelGeometryRegistryV1([
    {
      version: 1,
      voxel: 500,
      boxes: [{ min: [minimum, 0, 0], max: [minimum + 0.125, 1, 1], material: FaceMaterial.WoodenDoor }],
      collision: collision ? [{ min: [minimum, 0, 0], max: [minimum + 0.125, 1, 1] }] : [],
      occludesFullFace: false,
    },
  ]);

describe('per-world geometry presentation consumers', () => {
  it('builds isolated item meshes for the same storage id', () => {
    const first = itemMeshDefinition(500, undefined, geometry(0.125));
    const second = itemMeshDefinition(500, undefined, geometry(0.75));
    const xs = (definition: typeof first) =>
      definition.groups.flatMap((group) => group.positions.filter((_value, index) => index % 3 === 0));

    expect(new Set(xs(first))).toEqual(new Set([0.125, 0.25]));
    expect(new Set(xs(second))).toEqual(new Set([0.75, 0.875]));
    expect(first.groups[0]?.material).toBe(FaceMaterial.WoodenDoor);
  });

  it('uses registered target collision and preserves an explicit empty collision list', () => {
    const snapshot = {
      epoch: 'sample:world',
      physicsTick: 1,
      authoritative: [],
      targetVoxel: { position: [8, 4, -3] as const, voxel: 500 },
      truncatedBodyCount: 0,
    };
    const closed = createCollisionDebugBatch(snapshot, { x: 8, y: 4, z: -3 }, { voxelGeometry: geometry(0.125) });
    const other = createCollisionDebugBatch(snapshot, { x: 8, y: 4, z: -3 }, { voxelGeometry: geometry(0.75) });
    const open = createCollisionDebugBatch(snapshot, { x: 8, y: 4, z: -3 }, { voxelGeometry: geometry(0.75, false) });
    const targetX = closed.lines
      .filter((line) => line.source === 'target-voxel')
      .flatMap((line) => [closed.positions[line.vertexOffset * 3], closed.positions[line.vertexOffset * 3 + 3]]);

    expect(Math.min(...targetX)).toBe(8.125);
    expect(Math.max(...targetX)).toBe(8.25);
    expect(Math.min(...other.positions)).toBe(-3);
    const otherTargetX = other.lines
      .filter((line) => line.source === 'target-voxel')
      .flatMap((line) => [other.positions[line.vertexOffset * 3], other.positions[line.vertexOffset * 3 + 3]]);
    expect(Math.min(...otherTargetX)).toBe(8.75);
    expect(Math.max(...otherTargetX)).toBe(8.875);
    expect(open.lines.filter((line) => line.source === 'target-voxel')).toHaveLength(0);
  });
});
