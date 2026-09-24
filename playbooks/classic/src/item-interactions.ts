import { defineFluidContainerInteractionModule, defineItemInteractionModule } from '@seedlands/stdlib/mod-api';
import { Voxel } from '@seedlands/stdlib/world/voxel';

export const classicFluidContainerOperationId = 'seedlands:fluid-container-interact';

export const classicItemInteractionModules = [
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
    definitions: ['bucket', 'water-bucket', 'lava-bucket'].map((itemId) => ({
      id: `seedlands:${itemId}-voxel-interaction`,
      selector: { itemId: `seedlands:${itemId}` },
      trigger: 'voxel' as const,
      operationId: classicFluidContainerOperationId,
      presentationKey: `seedlands:${itemId}`,
    })),
  }),
] as const;
