import { defineStructureActionsModuleV1, type StructureActionPolicyV1 } from '@seedlands/stdlib/mod-api';
import { overworldBlocks } from './blocks';
import { classicWoodenDoorClosedStateForBearing } from './structures';
import { overworldItems } from './items';

const replaceable = new Set(overworldBlocks.filter((block) => block.replaceable).map((block) => block.voxel));
const durableMiningTools = new Set(
  overworldItems
    .filter((item) => item.durability && item.capabilities.some((capability) => capability.type === 'mine'))
    .map((item) => item.id),
);

export const classicStructureActionPolicy: StructureActionPolicyV1 = Object.freeze({
  placementState: (_definition, bearing) => classicWoodenDoorClosedStateForBearing(bearing),
  toggleTransitionId: () => 'toggle',
  isReplaceable: (voxel) => replaceable.has(voxel),
  breakToolWear: (_definition, selected) => (selected?.instance && durableMiningTools.has(selected.itemId) ? 1 : 0),
});

export const classicStructureActionsModule = defineStructureActionsModuleV1({
  moduleId: 'seedlands:overworld-structure-actions',
  policy: classicStructureActionPolicy,
});
