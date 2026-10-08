import {
  defineFluidContainerInteractionModule,
  defineItemInteractionModule,
  defineSoilTransformInteractionModule,
  defineCropInteractionModule,
  type SoilTransformInteractionConfig,
} from '@seedlands/stdlib/mod-api';
import { Voxel } from '@seedlands/stdlib/world/voxel';
import { classicCropConfig } from './crop-policy';

export const classicFluidContainerOperationId = 'seedlands:fluid-container-interact';
export const classicSoilTransformConfig: SoilTransformInteractionConfig = Object.freeze({
  moduleId: 'seedlands:soil-transform-handler',
  operationId: 'seedlands:till-soil',
  sourceVoxels: Object.freeze([Voxel.Grass, Voxel.Dirt]),
  targetVoxel: Voxel.Farmland,
  emptyAboveVoxels: Object.freeze([Voxel.Air]),
  durabilityCost: 1,
});

export const classicItemInteractionModules = [
  defineCropInteractionModule(classicCropConfig),
  defineSoilTransformInteractionModule(classicSoilTransformConfig),
  defineFluidContainerInteractionModule({
    moduleId: 'seedlands:fluid-container-handler',
    operationId: classicFluidContainerOperationId,
    emptyItemId: 'bucket',
    emptyVoxel: Voxel.Air,
    filled: [
      { itemId: 'water-bucket', voxel: Voxel.Water },
      { itemId: 'lava-bucket', voxel: Voxel.Lava },
    ],
    replaceableVoxels: [Voxel.Air, Voxel.Fire],
  }),
  defineItemInteractionModule({
    moduleId: 'seedlands:overworld-item-interactions',
    permissions: [{ resource: 'seedlands.block-voxel', operations: ['execute'] }],
    definitions: [
      {
        id: 'seedlands:seed-crop-interaction',
        selector: { itemId: 'seedlands:wheat-seeds' },
        trigger: 'voxel',
        operationId: classicCropConfig.plantOperationId,
        presentationKey: 'seedlands:plant-crop',
      },
      ...['bucket', 'water-bucket', 'lava-bucket'].map((itemId) => ({
        id: `seedlands:${itemId}-voxel-interaction`,
        selector: { itemId: `seedlands:${itemId}` },
        trigger: 'voxel' as const,
        operationId: classicFluidContainerOperationId,
        presentationKey: `seedlands:${itemId}`,
        ...(itemId === 'bucket' ? { voxelHitPolicy: 'fluid-source' as const } : {}),
      })),
      {
        id: 'seedlands:hoe-soil-interaction',
        selector: { capability: 'till' },
        trigger: 'voxel',
        operationId: classicSoilTransformConfig.operationId,
        presentationKey: 'seedlands:till-soil',
      },
    ],
  }),
] as const;
