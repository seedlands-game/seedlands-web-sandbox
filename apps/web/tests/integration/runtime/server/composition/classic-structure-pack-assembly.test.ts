import { expect, it } from 'vitest';
import { STRUCTURE_DEFINITIONS_CAPABILITY, VOXEL_GEOMETRY_CAPABILITY } from '@seedlands/stdlib/mod-api';
import { createClassicComposition } from '../../../../fixtures/classic/content';
import { classicWoodenDoorVariants } from '../../../../../../../playbooks/classic/src/structures';

it('assembles the real Classic pack with one matching Structure and geometry registry', () => {
  const composition = createClassicComposition();
  expect(composition.playbookId).toBe('seedlands:overworld');
  const capabilities = composition.definitionMap.capabilities.map(({ id }) => id);
  expect(capabilities).toContain(STRUCTURE_DEFINITIONS_CAPABILITY);
  expect(capabilities).toContain(VOXEL_GEOMETRY_CAPABILITY);
  const structures = composition.capability<import('@seedlands/stdlib/mod-api').StructureDefinitionRegistryV1>(
    STRUCTURE_DEFINITIONS_CAPABILITY,
  );
  const geometry =
    composition.capability<import('@seedlands/stdlib/mod-api').VoxelGeometryRegistryV1>(VOXEL_GEOMETRY_CAPABILITY);
  expect(structures.list().map(({ id }) => id)).toEqual(['seedlands:wooden-door']);
  expect(geometry.list().map(({ voxel }) => voxel)).toEqual(
    classicWoodenDoorVariants.map(({ storageId }) => storageId),
  );
  for (const variant of classicWoodenDoorVariants) {
    expect(composition.definitionMap.voxels).toContainEqual(expect.objectContaining({ storageId: variant.storageId }));
    expect(geometry.require(variant.storageId).collision.length > 0).toBe(!variant.open);
  }
});
