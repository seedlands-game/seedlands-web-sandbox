import type { ModModule } from '../../composition/contracts';
import type { ItemDefinitionRegistry } from '../item-registry';
import { freezeCropPolicy } from './crop-policy';
import {
  CROP_INTERACTION_CAPABILITY,
  CROP_CELL_COMPONENT,
  cropCellAddress,
  validateCropCellProjection,
  buildCropInteractionCandidate,
  type CropInteractionConfig,
} from './crop-interaction-model';
import {
  BLOCK_ACTIONS_CAPABILITY,
  BLOCK_ACTOR_RESOURCE,
  BLOCK_VOXEL_RESOURCE,
  blockActorAddress,
  blockVoxelAddress,
  validateBlockPosition,
} from './block-action-model';

export function defineCropInteractionModule(config: CropInteractionConfig): ModModule {
  const frozen = Object.freeze({
    moduleId: config.moduleId,
    plantOperationId: config.plantOperationId,
    ...(config.harvestOperationId ? { harvestOperationId: config.harvestOperationId } : {}),
    ...(config.fertilizeOperationId ? { fertilizeOperationId: config.fertilizeOperationId } : {}),
    ...freezeCropPolicy(config),
  });
  if (Boolean(frozen.fertilizer) !== Boolean(frozen.fertilizeOperationId))
    throw new TypeError('Crop fertilizer requires its registered operation.');
  return Object.freeze({
    descriptor: {
      id: frozen.moduleId,
      version: '1.0.0',
      requires: [
        { id: BLOCK_ACTIONS_CAPABILITY, version: '1.0.0' },
        { id: 'seedlands:items', version: '1.0.0' },
      ],
      provides: [{ id: CROP_INTERACTION_CAPABILITY, version: '1.0.0', definitionIdentity: JSON.stringify(frozen) }],
      permissions: [
        { resource: BLOCK_ACTOR_RESOURCE, operations: ['read', 'execute'] },
        { resource: BLOCK_VOXEL_RESOURCE, operations: ['read', 'execute'] },
      ],
    },
    register(api) {
      api.requireCapability(BLOCK_ACTIONS_CAPABILITY);
      const items = api.requireCapability<ItemDefinitionRegistry>('seedlands:items');
      api.provideCapability(CROP_INTERACTION_CAPABILITY, frozen);
      api.registerState({
        id: CROP_CELL_COMPONENT,
        version: '1.0.0',
        resource: BLOCK_VOXEL_RESOURCE,
        validate(value) {
          try {
            validateCropCellProjection(value);
            return true;
          } catch {
            return false;
          }
        },
      });
      const operations = [
        ['plant', frozen.plantOperationId],
        ['harvest', frozen.harvestOperationId],
        ['fertilize', frozen.fertilizeOperationId],
      ] as const;
      for (const [action, operationId] of operations) {
        if (!operationId) continue;
        api.registerOperation({
          id: operationId,
          resource: BLOCK_VOXEL_RESOURCE,
          run(context, input, state) {
            if (context.target.kind !== 'voxel') throw new TypeError('Crop planting requires a voxel target.');
            const target = input as { target?: { hit?: unknown; adjacent?: unknown } };
            const hit = validateBlockPosition(target?.target?.hit, 'Crop planting hit'),
              adjacent = validateBlockPosition(target?.target?.adjacent, 'Crop planting adjacent');
            const above: readonly [number, number, number] = [hit[0], hit[1] + 1, hit[2]];
            const hitValue = state.read(blockVoxelAddress(hit)),
              adjacentValue = state.read(blockVoxelAddress(adjacent));
            const aboveValue = above.every((value, axis) => value === adjacent[axis])
              ? adjacentValue
              : state.read(blockVoxelAddress(above));
            return buildCropInteractionCandidate(
              action,
              items,
              frozen,
              state.read(blockActorAddress(context.originalActorId)),
              hitValue,
              adjacentValue,
              aboveValue,
              state.read(cropCellAddress(hit)),
              input,
            );
          },
        });
      }
    },
  } satisfies ModModule);
}
