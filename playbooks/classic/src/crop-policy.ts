import { Voxel } from '@seedlands/stdlib/world/voxel';
import type { CropInteractionConfig } from '@seedlands/stdlib/mod-api';

export const classicCropConfig: CropInteractionConfig = Object.freeze({
  moduleId: 'seedlands:overworld-crops',
  plantOperationId: 'seedlands:plant-crop',
  harvestOperationId: 'seedlands:harvest-crop',
  fertilizeOperationId: 'seedlands:fertilize-crop',
  soilVoxels: Object.freeze([Voxel.Farmland]),
  emptyAboveVoxels: Object.freeze([Voxel.Air]),
  waterVoxels: Object.freeze([Voxel.Water]),
  seedItemId: 'wheat-seeds',
  matureDrops: Object.freeze([
    { itemId: 'wheat', count: 1 },
    { itemId: 'wheat-seeds', count: 1 },
  ]),
  immatureDrops: Object.freeze([{ itemId: 'wheat-seeds', count: 1 }]),
  fertilizer: Object.freeze({ itemId: 'white-dye', growthStages: 7 }),
});
