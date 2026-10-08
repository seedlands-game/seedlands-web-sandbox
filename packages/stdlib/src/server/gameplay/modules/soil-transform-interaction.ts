import type { ModModule } from '../../composition/contracts';
import type { ItemDefinitionRegistry } from '../item-registry';
import { createInventoryCandidate } from './inventory-api';
import { tillOutcome, type TillPolicy } from './till-policy';
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

export const SOIL_TRANSFORM_INTERACTION_CAPABILITY = 'seedlands:soil-transform-interaction';
export type SoilTransformInteractionConfig = TillPolicy &
  Readonly<{
    moduleId: string;
    operationId: string;
    emptyAboveVoxels: readonly number[];
  }>;
export type SoilTransformInteractionCandidateV1 = Readonly<{
  version: 1;
  kind: 'soil-transform';
  actorId: string;
  actorReference: BlockActorProjectionV1['reference'];
  hit: BlockVoxelProjectionV1;
  adjacent: BlockVoxelProjectionV1;
  above: BlockVoxelProjectionV1;
  targetPosition: BlockPosition;
  fromVoxel: number;
  toVoxel: number;
  slots: BlockActorProjectionV1['slots'];
  creative: boolean;
  result: Readonly<{ version: 1; success: true; action: 'till'; actorId: string }>;
}>;
const samePosition = (a: readonly number[], b: readonly number[]) => a.every((value, axis) => value === b[axis]);
export const soilAbovePosition = (position: BlockPosition): BlockPosition =>
  Object.freeze([position[0], position[1] + 1, position[2]]);

export function buildSoilTransformInteractionCandidate(
  items: ItemDefinitionRegistry,
  config: SoilTransformInteractionConfig,
  rawActor: unknown,
  rawHit: unknown,
  rawAdjacent: unknown,
  rawAbove: unknown,
  rawInput: unknown,
): SoilTransformInteractionCandidateV1 {
  const actor = validateBlockActorProjection(rawActor, items);
  const hit = validateBlockVoxelProjection(rawHit);
  const adjacent = validateBlockVoxelProjection(rawAdjacent);
  const above = validateBlockVoxelProjection(rawAbove);
  const input = rawInput as {
    version?: unknown;
    trigger?: unknown;
    target?: { kind?: unknown; hit?: unknown; adjacent?: unknown };
  };
  if (input?.version !== 1 || input.trigger !== 'voxel' || input.target?.kind !== 'voxel')
    throw new TypeError('Soil interaction input is invalid.');
  const inputHit = validateBlockPosition(input.target.hit, 'Soil interaction hit');
  const inputAdjacent = validateBlockPosition(input.target.adjacent, 'Soil interaction adjacent');
  if (
    !samePosition(hit.position, inputHit) ||
    !samePosition(adjacent.position, inputAdjacent) ||
    !samePosition(above.position, soilAbovePosition(inputHit)) ||
    inputHit.reduce((sum, value, axis) => sum + Math.abs(value - inputAdjacent[axis]), 0) !== 1
  )
    throw new TypeError('Soil interaction target does not match its projections.');
  if (actor.lifecycle !== 'alive') throw new Error('player-dead');
  if (!config.emptyAboveVoxels.includes(above.voxel)) throw new Error('till-above-occupied');
  const creative = actor.mode.value === 'creative';
  const selected = creative
    ? actor.creativeCatalog.hotbar[actor.creativeCatalog.selectedSlot]
    : actor.slots[actor.equipment.selectedSlot]?.itemId;
  if (!selected) throw new Error('no-selected-item');
  const inventory = createInventoryCandidate(items, actor.slots);
  const durability = items.require(selected).durability;
  const stack = creative
    ? items.normalizeStack({
        itemId: selected,
        count: 1,
        ...(durability ? { instance: { durability: durability.max } } : {}),
      })
    : inventory.slot(actor.equipment.selectedSlot)!;
  const outcome = tillOutcome(items, hit.voxel, stack, config, creative);
  if (!creative) {
    const slots = inventory.snapshot();
    slots[actor.equipment.selectedSlot] = outcome.nextStack;
    inventory.replace(slots);
  }
  return Object.freeze({
    version: 1,
    kind: 'soil-transform',
    actorId: actor.reference.entityId,
    actorReference: actor.reference,
    hit,
    adjacent,
    above,
    targetPosition: Object.freeze([...hit.position]) as BlockPosition,
    fromVoxel: hit.voxel,
    toVoxel: outcome.toVoxel,
    slots: Object.freeze(inventory.snapshot()),
    creative,
    result: Object.freeze({ version: 1, success: true, action: 'till', actorId: actor.reference.entityId }),
  });
}

export function defineSoilTransformInteractionModule(config: SoilTransformInteractionConfig): ModModule {
  const voxels = (values: readonly number[]) => {
    if (
      !Array.isArray(values) ||
      !values.length ||
      values.length > 512 ||
      values.some((value) => !Number.isSafeInteger(value) || value < 0) ||
      new Set(values).size !== values.length
    )
      throw new TypeError('Soil interaction voxel policy is invalid.');
    return Object.freeze([...values]);
  };
  if (
    !Number.isSafeInteger(config.targetVoxel) ||
    config.targetVoxel < 0 ||
    !Number.isSafeInteger(config.durabilityCost) ||
    config.durabilityCost < 0
  )
    throw new TypeError('Soil interaction policy is invalid.');
  const frozen = Object.freeze({
    ...config,
    sourceVoxels: voxels(config.sourceVoxels),
    emptyAboveVoxels: voxels(config.emptyAboveVoxels),
  });
  return Object.freeze({
    descriptor: {
      id: frozen.moduleId,
      version: '1.0.0',
      requires: [
        { id: BLOCK_ACTIONS_CAPABILITY, version: '1.0.0' },
        ...GAMEPLAY_CONTENT_CAPABILITIES.map((id) => ({ id, version: '1.0.0' })),
      ],
      provides: [
        {
          id: SOIL_TRANSFORM_INTERACTION_CAPABILITY,
          version: '1.0.0',
          definitionIdentity: JSON.stringify(frozen),
        },
      ],
      permissions: [
        { resource: BLOCK_ACTOR_RESOURCE, operations: ['read', 'execute'] },
        { resource: BLOCK_VOXEL_RESOURCE, operations: ['read', 'execute'] },
      ],
    },
    register(api) {
      api.requireCapability(BLOCK_ACTIONS_CAPABILITY);
      const items = api.requireCapability<ItemDefinitionRegistry>('seedlands:items');
      api.provideCapability(SOIL_TRANSFORM_INTERACTION_CAPABILITY, frozen);
      api.registerOperation({
        id: frozen.operationId,
        resource: BLOCK_VOXEL_RESOURCE,
        run(context, input, state) {
          if (context.target.kind !== 'voxel') throw new TypeError('Soil interaction requires a voxel target.');
          const target = input as { target?: { hit?: unknown; adjacent?: unknown } };
          const hit = validateBlockPosition(target?.target?.hit, 'Soil interaction hit');
          const adjacent = validateBlockPosition(target?.target?.adjacent, 'Soil interaction adjacent');
          const hitProjection = state.read(blockVoxelAddress(hit));
          const adjacentProjection = state.read(blockVoxelAddress(adjacent));
          const abovePosition = soilAbovePosition(hit);
          const aboveProjection = samePosition(adjacent, abovePosition)
            ? adjacentProjection
            : state.read(blockVoxelAddress(abovePosition));
          const candidate = buildSoilTransformInteractionCandidate(
            items,
            frozen,
            state.read(blockActorAddress(context.originalActorId)),
            hitProjection,
            adjacentProjection,
            aboveProjection,
            input,
          );
          if (candidate.actorId !== context.originalActorId) throw new TypeError('Soil interaction actor changed.');
          return candidate;
        },
      });
    },
  } satisfies ModModule);
}

export const isSoilTransformInteractionCandidate = (value: unknown): value is SoilTransformInteractionCandidateV1 =>
  Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as { kind?: unknown }).kind === 'soil-transform',
  );
