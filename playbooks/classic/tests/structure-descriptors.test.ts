import { describe, expect, it } from 'vitest';
import { FaceMaterial } from '@seedlands/stdlib/world/voxel';
import { createVoxelGeometryRegistryV1 } from '@seedlands/stdlib/mod-api';
import {
  CLASSIC_WOODEN_DOOR_LEGACY_STORAGE_ID,
  classicWoodenDoorOrientations,
  classicWoodenDoorVariants,
} from '../src/structures';
import { classicWoodenDoorGeometryDescriptors } from '../src/structure-descriptors';

const THICKNESS = 3 / 16;
const side = (orientation: string) => {
  switch (orientation) {
    case 'north':
      return { min: [0, 0, 0], max: [1, 1, THICKNESS] };
    case 'east':
      return { min: [1 - THICKNESS, 0, 0], max: [1, 1, 1] };
    case 'south':
      return { min: [0, 0, 1 - THICKNESS], max: [1, 1, 1] };
    case 'west':
      return { min: [0, 0, 0], max: [THICKNESS, 1, 1] };
    default:
      throw new Error(`Unknown fixture orientation: ${orientation}`);
  }
};
const openedToward = { north: 'west', east: 'north', south: 'east', west: 'south' } as const;

describe('Classic wooden door geometry descriptors', () => {
  it('declares exactly 89..104 and never reinterprets legacy voxel 52', () => {
    const registry = createVoxelGeometryRegistryV1(classicWoodenDoorGeometryDescriptors);
    const ids = registry.list().map(({ voxel }) => voxel);
    expect(ids).toEqual(classicWoodenDoorVariants.map(({ storageId }) => storageId));
    expect(ids).toEqual(Array.from({ length: 16 }, (_, index) => 89 + index));
    expect(registry.get(CLASSIC_WOODEN_DOOR_LEGACY_STORAGE_ID)).toBeUndefined();
  });

  it('uses one directional thin WoodenDoor box for every closed and open variant', () => {
    const registry = createVoxelGeometryRegistryV1(classicWoodenDoorGeometryDescriptors);
    for (const variant of classicWoodenDoorVariants) {
      const descriptor = registry.require(variant.storageId);
      const expected = side(variant.open ? openedToward[variant.orientation] : variant.orientation);
      expect(descriptor.boxes).toEqual([{ ...expected, material: FaceMaterial.WoodenDoor }]);
      expect(descriptor.collision).toEqual(variant.open ? [] : [expected]);
      expect(descriptor.occludesFullFace).toBe(false);
    }
  });

  it('keeps lower and upper geometry identical within each orientation/state', () => {
    const registry = createVoxelGeometryRegistryV1(classicWoodenDoorGeometryDescriptors);
    for (const orientation of classicWoodenDoorOrientations)
      for (const open of [false, true]) {
        const variants = classicWoodenDoorVariants.filter(
          (candidate) => candidate.orientation === orientation && candidate.open === open,
        );
        const lower = registry.require(variants.find(({ role }) => role === 'lower')!.storageId);
        const upper = registry.require(variants.find(({ role }) => role === 'upper')!.storageId);
        expect({ boxes: lower.boxes, collision: lower.collision, occludesFullFace: lower.occludesFullFace }).toEqual({
          boxes: upper.boxes,
          collision: upper.collision,
          occludesFullFace: upper.occludesFullFace,
        });
      }
  });
});
