import { createVoxelGeometryRegistryV1, type VoxelGeometryDefinitionV1 } from '@seedlands/stdlib/mod-api';
import { FaceMaterial } from '@seedlands/stdlib/world/voxel';
import { classicWoodenDoorVariants, type ClassicWoodenDoorOrientation } from './structures';

const THICKNESS = 3 / 16;
const openedToward: Readonly<Record<ClassicWoodenDoorOrientation, ClassicWoodenDoorOrientation>> = Object.freeze({
  north: 'west',
  east: 'north',
  south: 'east',
  west: 'south',
});

const boxFor = (orientation: ClassicWoodenDoorOrientation) => {
  switch (orientation) {
    case 'north':
      return { min: [0, 0, 0] as const, max: [1, 1, THICKNESS] as const };
    case 'east':
      return { min: [1 - THICKNESS, 0, 0] as const, max: [1, 1, 1] as const };
    case 'south':
      return { min: [0, 0, 1 - THICKNESS] as const, max: [1, 1, 1] as const };
    case 'west':
      return { min: [0, 0, 0] as const, max: [THICKNESS, 1, 1] as const };
  }
};

const definitions: readonly VoxelGeometryDefinitionV1[] = classicWoodenDoorVariants.map((variant) => {
  const shape = boxFor(variant.open ? openedToward[variant.orientation] : variant.orientation);
  return {
    version: 1,
    voxel: variant.storageId,
    boxes: [{ ...shape, material: FaceMaterial.WoodenDoor }],
    collision: variant.open ? [] : [shape],
    occludesFullFace: false,
  };
});

export const classicWoodenDoorGeometryDescriptors = createVoxelGeometryRegistryV1(definitions).list();
