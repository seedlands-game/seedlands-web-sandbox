import { describe, expect, it } from 'vitest';
import {
  buildWaterSurfaceTransition,
  type WaterSurfaceTransitionGeometry,
} from '../../src/app/scene/water-surface-transition';
import { batchMeshData, compactMeshData, meshChunk, type MeshData } from '../../src/world/mesh';
import { CHUNK_SIZE, FaceMaterial, Voxel, voxelIndex } from '../../src/world/voxel';

type WaterCell = { x: number; y: number; z: number; level: number };

const waterParts = (cells: readonly WaterCell[]): MeshData[] => {
  if (!cells.length) return [];
  const data = new Uint16Array(CHUNK_SIZE ** 3);
  const fluid = new Uint8Array(CHUNK_SIZE ** 3);
  for (const cell of cells) {
    const index = voxelIndex(cell.x, cell.y, cell.z);
    data[index] = Voxel.Water;
    fluid[index] = cell.level;
  }
  const water = meshChunk({ seed: 1, cx: 0, cy: 0, cz: 0, data, fluid, changes: [] })[FaceMaterial.Water];
  return [compactMeshData(batchMeshData([water])[0])];
};

const geometry = (result: ReturnType<typeof buildWaterSurfaceTransition>): WaterSurfaceTransitionGeometry => {
  expect(result.kind).toBe('transition');
  if (result.kind !== 'transition') throw new Error(`Expected transition, received ${result.kind}.`);
  return result.geometry;
};

const positionsAt = (value: WaterSurfaceTransitionGeometry, progress: number) =>
  Float32Array.from(value.startPositions, (position, index) => position + value.deltaPositions[index] * progress);

const patchPositions = (positions: Float32Array, patch: number) => positions.slice(patch * 12, patch * 12 + 12);
const axisValues = (positions: Float32Array, axis: number) =>
  [...positions].filter((_value, index) => index % 3 === axis);

describe('water surface geometry transition', () => {
  it('does not animate an unchanged committed water mesh', () => {
    const stable = waterParts([{ x: 1, y: 1, z: 1, level: 8 }]);

    expect(buildWaterSurfaceTransition(stable, stable)).toEqual({ kind: 'unchanged', patchCount: 6 });
  });

  it('morphs one stable surface from the old committed height to the new height', () => {
    const result = buildWaterSurfaceTransition(
      waterParts([{ x: 1, y: 1, z: 1, level: 8 }]),
      waterParts([{ x: 1, y: 1, z: 1, level: 4 }]),
    );
    expect(result.kind).toBe('transition');
    if (result.kind !== 'transition') throw new Error(`Expected transition, received ${result.kind}.`);
    const value = geometry(result);

    expect(result).toMatchObject({ retainedPatchCount: 6, addedPatchCount: 0, removedPatchCount: 0 });
    expect(Math.max(...axisValues(positionsAt(value, 0), 1))).toBe(1.875);
    expect(Math.max(...axisValues(positionsAt(value, 0.5), 1))).toBe(1.6875);
    expect(Math.max(...axisValues(positionsAt(value, 1), 1))).toBe(1.5);
  });

  it('matches stable unit faces when greedy topology splits after a level change', () => {
    const result = buildWaterSurfaceTransition(
      waterParts([
        { x: 1, y: 1, z: 1, level: 8 },
        { x: 2, y: 1, z: 1, level: 8 },
      ]),
      waterParts([
        { x: 1, y: 1, z: 1, level: 8 },
        { x: 2, y: 1, z: 1, level: 4 },
      ]),
    );
    expect(result.kind).toBe('transition');
    if (result.kind !== 'transition') throw new Error(`Expected transition, received ${result.kind}.`);
    const value = geometry(result);

    expect(new Set(value.patchKeys).size).toBe(value.patchKeys.length);
    expect(result).toMatchObject({ addedPatchCount: 1, removedPatchCount: 0 });
    expect(result.retainedPatchCount).toBeGreaterThan(6);
  });

  it('expands an added top face from an adjacent old boundary and an isolated top from its cell floor', () => {
    const adjacent = geometry(
      buildWaterSurfaceTransition(
        waterParts([{ x: 1, y: 1, z: 1, level: 8 }]),
        waterParts([
          { x: 1, y: 1, z: 1, level: 8 },
          { x: 2, y: 1, z: 1, level: 8 },
        ]),
      ),
    );
    const adjacentPatch = adjacent.patchKinds.findIndex((kind, index) => {
      if (kind !== 1) return false;
      const end = patchPositions(positionsAt(adjacent, 1), index);
      return Math.min(...axisValues(end, 0)) === 2 && Math.max(...axisValues(end, 0)) === 3;
    });
    expect(adjacentPatch).toBeGreaterThanOrEqual(0);
    expect(new Set(axisValues(patchPositions(adjacent.startPositions, adjacentPatch), 0))).toEqual(new Set([2]));
    const advancingBoundary = adjacent.patchKinds.findIndex((kind, index) => {
      if (kind !== 0 || !adjacent.patchKeys[index].startsWith('side-x:')) return false;
      const start = patchPositions(adjacent.startPositions, index);
      const end = patchPositions(positionsAt(adjacent, 1), index);
      return new Set(axisValues(start, 0)).has(2) && new Set(axisValues(end, 0)).has(3);
    });
    expect(advancingBoundary).toBeGreaterThanOrEqual(0);

    const isolated = geometry(buildWaterSurfaceTransition([], waterParts([{ x: 4, y: 1, z: 4, level: 8 }])));
    const isolatedTop = isolated.patchKeys.findIndex((key) => key.startsWith('top:'));
    expect(isolatedTop).toBeGreaterThanOrEqual(0);
    expect(new Set(axisValues(patchPositions(isolated.startPositions, isolatedTop), 1))).toEqual(new Set([1]));
    expect(new Set(axisValues(patchPositions(positionsAt(isolated, 1), isolatedTop), 1))).toEqual(new Set([1.875]));
  });

  it('retracts a removed surface into the adjacent new boundary before the final mesh swap', () => {
    const result = buildWaterSurfaceTransition(
      waterParts([
        { x: 1, y: 1, z: 1, level: 8 },
        { x: 2, y: 1, z: 1, level: 8 },
      ]),
      waterParts([{ x: 1, y: 1, z: 1, level: 8 }]),
    );
    const value = geometry(result);
    const removedTop = value.patchKinds.findIndex(
      (kind, index) => kind === 2 && value.patchKeys[index].startsWith('top:'),
    );

    expect(removedTop).toBeGreaterThanOrEqual(0);
    expect(new Set(axisValues(patchPositions(positionsAt(value, 1), removedTop), 0))).toEqual(new Set([2]));
  });

  it('fails closed to an immediate committed mesh when the per-chunk patch budget is exceeded', () => {
    const result = buildWaterSurfaceTransition([], waterParts([{ x: 1, y: 1, z: 1, level: 8 }]), {
      maxPatches: 5,
    });

    expect(result).toEqual({ kind: 'budget-exceeded', patchCount: 6, maxPatches: 5 });
  });
});
