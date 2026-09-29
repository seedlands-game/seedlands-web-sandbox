import type { ModModule } from '../../composition/contracts';
import type { ItemDefinitionRegistry } from '../item-registry';
import { createInventoryCandidate } from './inventory-api';
import { GAMEPLAY_CONTENT_CAPABILITIES } from './content-capabilities';
import {
  BLOCK_ACTIONS_CAPABILITY,
  BLOCK_ACTOR_RESOURCE,
  BLOCK_VOXEL_RESOURCE,
  blockActorAddress,
  blockVoxelAddress,
  validateBlockActorProjection,
  validateBlockPosition,
  validateBlockVoxelProjection,
  type BlockActorProjectionV1,
  type BlockPosition,
  type BlockVoxelProjectionV1,
} from './block-action-model';

export const FLUID_CONTAINER_INTERACTION_CAPABILITY = 'seedlands:fluid-container-interaction';

export type FluidContainerInteractionConfig = Readonly<{
  moduleId: string;
  operationId: string;
  emptyItemId: string;
  emptyVoxel: number;
  filled: readonly Readonly<{ itemId: string; voxel: number }>[];
  replaceableVoxels: readonly number[];
}>;
export type FluidContainerInteractionCandidateV1 = Readonly<{
  version: 1;
  kind: 'fluid-container';
  actorId: string;
  actorReference: BlockActorProjectionV1['reference'];
  hit: BlockVoxelProjectionV1;
  adjacent: BlockVoxelProjectionV1;
  targetPosition: BlockPosition;
  fromVoxel: number;
  toVoxel: number;
  slots: BlockActorProjectionV1['slots'];
  creative: boolean;
  result: Readonly<{ version: 1; success: true; action: 'fill' | 'empty'; actorId: string }>;
}>;

const samePosition = (left: readonly number[], right: readonly number[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);
const adjacent = (left: readonly number[], right: readonly number[]) =>
  left.reduce((sum, value, index) => sum + Math.abs(value - right[index]), 0) === 1;
const fail = (reason: string): never => {
  throw new Error(reason);
};

export function buildFluidContainerInteractionCandidate(
  items: ItemDefinitionRegistry,
  config: FluidContainerInteractionConfig,
  rawActor: unknown,
  rawHit: unknown,
  rawAdjacent: unknown,
  rawInput: unknown,
): FluidContainerInteractionCandidateV1 {
  const actor = validateBlockActorProjection(rawActor, items);
  const hit = validateBlockVoxelProjection(rawHit);
  const next = validateBlockVoxelProjection(rawAdjacent);
  const input = rawInput as {
    version?: unknown;
    trigger?: unknown;
    target?: { kind?: unknown; hit?: unknown; adjacent?: unknown };
  };
  if (input?.version !== 1 || input.trigger !== 'voxel' || input.target?.kind !== 'voxel')
    throw new TypeError('Fluid interaction input is invalid.');
  const inputHit = validateBlockPosition(input.target.hit, 'Fluid interaction hit');
  const inputAdjacent = validateBlockPosition(input.target.adjacent, 'Fluid interaction adjacent');
  if (
    !samePosition(hit.position, inputHit) ||
    !samePosition(next.position, inputAdjacent) ||
    !adjacent(inputHit, inputAdjacent)
  )
    throw new TypeError('Fluid interaction target does not match its projections.');
  if (actor.lifecycle !== 'alive') fail('player-dead');
  const creative = actor.mode.value === 'creative';
  const selectedItemId = creative
    ? actor.creativeCatalog.hotbar[actor.creativeCatalog.selectedSlot]
    : actor.slots[actor.equipment.selectedSlot]?.itemId;
  if (!selectedItemId) fail('no-selected-item');
  const inventory = createInventoryCandidate(items, actor.slots);
  let action: 'fill' | 'empty';
  let targetPosition: BlockPosition;
  let fromVoxel: number;
  let toVoxel: number;
  let outputItemId: string;
  if (selectedItemId === config.emptyItemId) {
    const source = config.filled.find(({ voxel }) => voxel === hit.voxel);
    if (!source || hit.fluid?.source !== true || hit.fluid.level !== 8) fail('not-fluid-source');
    action = 'fill';
    targetPosition = Object.freeze([...hit.position]) as BlockPosition;
    fromVoxel = hit.voxel;
    toVoxel = config.emptyVoxel;
    outputItemId = source!.itemId;
  } else {
    const source = config.filled.find(({ itemId }) => itemId === selectedItemId);
    if (!source) fail('item-no-interaction');
    if (!config.replaceableVoxels.includes(next.voxel)) fail('target-occupied');
    action = 'empty';
    targetPosition = Object.freeze([...next.position]) as BlockPosition;
    fromVoxel = next.voxel;
    toVoxel = source!.voxel;
    outputItemId = config.emptyItemId;
  }
  if (!creative) {
    if (
      !inventory.removeFromSlot(actor.equipment.selectedSlot, 1) ||
      !inventory.add({ itemId: outputItemId, count: 1 })
    )
      fail('inventory-full');
  }
  return Object.freeze({
    version: 1,
    kind: 'fluid-container',
    actorId: actor.reference.entityId,
    actorReference: actor.reference,
    hit,
    adjacent: next,
    targetPosition,
    fromVoxel,
    toVoxel,
    slots: Object.freeze(inventory.snapshot()),
    creative,
    result: Object.freeze({ version: 1, success: true, action, actorId: actor.reference.entityId }),
  });
}

export function defineFluidContainerInteractionModule(config: FluidContainerInteractionConfig): ModModule {
  const frozen = Object.freeze({
    ...config,
    filled: Object.freeze(config.filled.map((entry) => Object.freeze({ ...entry }))),
    replaceableVoxels: Object.freeze([...config.replaceableVoxels]),
  });
  return Object.freeze({
    descriptor: {
      id: frozen.moduleId,
      version: '1.0.0',
      requires: [
        { id: BLOCK_ACTIONS_CAPABILITY, version: '1.0.0' },
        ...GAMEPLAY_CONTENT_CAPABILITIES.map((id) => ({ id, version: '1.0.0' })),
      ],
      provides: [{ id: FLUID_CONTAINER_INTERACTION_CAPABILITY, version: '1.0.0' }],
      permissions: [
        { resource: BLOCK_ACTOR_RESOURCE, operations: ['read', 'execute'] },
        { resource: BLOCK_VOXEL_RESOURCE, operations: ['read', 'execute'] },
      ],
    },
    register(api) {
      api.requireCapability(BLOCK_ACTIONS_CAPABILITY);
      const items = api.requireCapability<ItemDefinitionRegistry>('seedlands:items');
      api.provideCapability(FLUID_CONTAINER_INTERACTION_CAPABILITY, frozen);
      api.registerOperation({
        id: frozen.operationId,
        resource: BLOCK_VOXEL_RESOURCE,
        run(context, input, state) {
          if (context.target.kind !== 'voxel') throw new TypeError('Fluid interaction requires a voxel target.');
          const target = input as { target?: { hit?: unknown; adjacent?: unknown } };
          const hit = validateBlockPosition(target?.target?.hit, 'Fluid interaction hit');
          const next = validateBlockPosition(target?.target?.adjacent, 'Fluid interaction adjacent');
          const result = buildFluidContainerInteractionCandidate(
            items,
            frozen,
            state.read(blockActorAddress(context.originalActorId)),
            state.read(blockVoxelAddress(hit)),
            state.read(blockVoxelAddress(next)),
            input,
          );
          if (result.actorId !== context.originalActorId) throw new TypeError('Fluid interaction actor changed.');
          return result;
        },
      });
    },
  } satisfies ModModule);
}

export const isFluidContainerInteractionCandidate = (value: unknown): value is FluidContainerInteractionCandidateV1 =>
  Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as { kind?: unknown }).kind === 'fluid-container',
  );
