import { expect, it, vi } from 'vitest';
import { loadedWorldBodyRejection } from '../../src/server/gameplay/transport-deployment-geometry';
import { createVoxelSemanticsRegistry } from '../../src/world/voxel-semantics';
import { createVoxelGeometryRegistryV1 } from '../../src/world/voxel-geometry';
import { bodyConfigFor } from '../../src/physics/body-registry';

const voxelSemantics = createVoxelSemanticsRegistry(
  [0, 3, 500].map((storageId) => ({
    id: `sample:voxel-${storageId}`,
    storageId,
    solid: storageId !== 0,
    targetable: storageId !== 0,
    renderable: storageId !== 0,
    meshKind: 'cube' as const,
    emission: 0,
    lightCost: 1,
    faceMaterials: [4, 4, 4, 4, 4, 4] as const,
  })),
);
const content = { voxelSemantics };
const local = bodyConfigFor('player').localAabb;

it('rejects non-indexable or precision-collapsed bodies before invoking the loaded world reader', () => {
  const getLoadedVoxel = vi.fn(() => 0);
  for (const position of [
    [1e308, 60, 0],
    [Number.MAX_SAFE_INTEGER + 8, 60, 0],
    [Infinity, 60, 0],
  ] as const)
    expect(loadedWorldBodyRejection({ content, callbacks: { getLoadedVoxel } }, local, position)).toBe(
      'transport-body-invalid',
    );
  expect(getLoadedVoxel).not.toHaveBeenCalled();
});

it('rejects oversized body scans before invoking the loaded world reader', () => {
  const getLoadedVoxel = vi.fn(() => 0);
  const bounds = { min: { x: -16, y: 0, z: -16 }, max: { x: 16, y: 32, z: 16 } };
  expect(loadedWorldBodyRejection({ content, callbacks: { getLoadedVoxel } }, bounds, [0, 60, 0])).toBe(
    'transport-body-capacity',
  );
  expect(getLoadedVoxel).not.toHaveBeenCalled();
});

it('keeps a partially unknown body unavailable even when an earlier loaded cell is occupied', () => {
  const getLoadedVoxel = ([x]: [number, number, number]) => (x === 0 ? 3 : undefined);
  const bounds = { min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 1, z: 1 } };
  expect(loadedWorldBodyRejection({ content, callbacks: { getLoadedVoxel } }, bounds, [0, 60, 0])).toBe(
    'chunk-unavailable',
  );
});

it('uses registered collision geometry for exit ground rather than the solid flag', () => {
  const shape = { min: [0, 0, 0] as const, max: [1, 0.5, 1] as const };
  const voxelGeometry = createVoxelGeometryRegistryV1([
    { version: 1, voxel: 500, boxes: [{ ...shape, material: 4 }], collision: [shape], occludesFullFace: false },
  ]);
  const callbacks = { getLoadedVoxel: () => 500, voxelGeometry };
  const floor = { min: { ...local.min, y: -0.025 }, max: { ...local.max, y: -1e-6 } };
  expect(loadedWorldBodyRejection({ content, callbacks }, floor, [0.5, 60, 0.5])).toBeNull();
  expect(loadedWorldBodyRejection({ content, callbacks }, floor, [0.5, 59.5, 0.5])).toBe('target-occupied');
});
