import { expect, it } from 'vitest';
import { assembleWorldPacks, definePack } from '../src/server/composition/assembly';
import type { VerifiedPackArtifact } from '../src/server/composition/contracts';
import { defineContentModule } from '../src/server/gameplay/modules/content-module';
import { defineBlockActionsModule } from '../src/server/gameplay/modules/block-actions-module';
import {
  BLOCK_ACTIONS_CAPABILITY,
  BLOCK_VOXEL_RESOURCE,
  type BlockActionsCapabilityV1,
} from '../src/server/gameplay/modules/block-action-model';
import { defineCropInteractionModule } from '../src/server/gameplay/modules/crop-interaction-module';
import { CROP_CELL_COMPONENT } from '../src/server/gameplay/modules/crop-interaction-model';

const artifact = (modules: Parameters<typeof definePack>[0]['modules']): VerifiedPackArtifact => {
  const pack = definePack({ id: 'sample:crop-support', version: '1.0.0', kind: 'playbook', modules });
  return {
    ...pack,
    integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
  };
};
const assemble = (modules: Parameters<typeof definePack>[0]['modules']) => {
  const pack = artifact(modules);
  return assembleWorldPacks([pack], {
    approvedPermissions: {
      'sample:crop-support': pack.modules.flatMap((module) => module.descriptor.permissions ?? []),
    },
  });
};
const content = () =>
  defineContentModule({
    moduleId: 'sample:crop-content',
    items: [
      { id: 'sample:seed', name: 'Seed', stackLimit: 64, capabilities: [] },
      { id: 'sample:produce', name: 'Produce', stackLimit: 64, capabilities: [] },
    ],
    voxels: [3100, 3101, 3102, 3103].map((storageId) => ({
      id: `sample:voxel-${storageId}`,
      storageId,
      solid: storageId !== 3102,
      targetable: true,
      renderable: true,
      meshKind: 'cube' as const,
      emission: 0,
      lightCost: 1,
      faceMaterials: [1, 1, 1, 1, 1, 1] as const,
    })),
    meleeDefinitions: [],
  });
const cropInteractions = () =>
  defineCropInteractionModule({
    moduleId: 'sample:crop-interactions',
    plantOperationId: 'sample:plant',
    harvestOperationId: 'sample:harvest',
    soilVoxels: [3100, 3101],
    emptyAboveVoxels: [3102],
    waterVoxels: [3103],
    seedItemId: 'sample:seed',
    matureDrops: [{ itemId: 'sample:produce', count: 1 }],
    immatureDrops: [{ itemId: 'sample:seed', count: 1 }],
  });

it('keeps block actions crop-agnostic by default when no crop cell owner is registered', () => {
  const composition = assemble([content(), defineBlockActionsModule()]);
  const capability = composition.capability<BlockActionsCapabilityV1>(BLOCK_ACTIONS_CAPABILITY);

  expect(capability.cropSupport).toBeUndefined();
});

it('fails assembly when crop support is explicitly enabled without its crop-cell state', () => {
  expect(() => assemble([content(), defineBlockActionsModule({ crops: true })])).toThrow(/crop-cell state/i);
});

it('admits an actual generic crop interaction state under the block voxel resource', () => {
  const composition = assemble([content(), defineBlockActionsModule({ crops: true }), cropInteractions()]);
  const capability = composition.capability<BlockActionsCapabilityV1>(BLOCK_ACTIONS_CAPABILITY);
  const cropCell = composition.registrations.states.find(({ definition }) => definition.id === CROP_CELL_COMPONENT);
  const plant = composition.registrations.operations.find(({ definition }) => definition.id === 'sample:plant');
  const harvest = composition.registrations.operations.find(({ definition }) => definition.id === 'sample:harvest');

  expect(capability.cropSupport).toBe(true);
  expect(cropCell?.definition.resource).toBe(BLOCK_VOXEL_RESOURCE);
  expect(plant?.definition.resource).toBe(BLOCK_VOXEL_RESOURCE);
  expect(harvest?.definition.resource).toBe(BLOCK_VOXEL_RESOURCE);
});
