import type { CropRecord } from '../crop-runtime';
import type { ItemDefinitionRegistry } from '../item-registry';
import type { CropPolicy } from './crop-policy';
import { advanceCrop, harvestCrop } from './crop-growth-policy';
import { createInventoryCandidate } from './inventory-api';
import {
  validateBlockActorProjection,
  validateBlockPosition,
  validateBlockVoxelProjection,
  type BlockActorProjectionV1,
  type BlockPosition,
  type BlockVoxelProjectionV1,
} from './block-action-model';

export const CROP_INTERACTION_CAPABILITY = 'seedlands:crop-interaction';
export const CROP_CELL_COMPONENT = 'seedlands:crop-cell';
export type CropAction = 'plant' | 'harvest' | 'fertilize';
export type CropInteractionConfig = CropPolicy &
  Readonly<{
    moduleId: string;
    plantOperationId: string;
    harvestOperationId?: string;
    fertilizeOperationId?: string;
  }>;
export type CropCellProjectionV1 = Readonly<{ version: 1; position: BlockPosition; crop: CropRecord | null }>;
export const withCropSupportObservation = <Candidate extends object>(candidate: Candidate, cell: unknown) =>
  Object.freeze({ ...candidate, cropSupport: validateCropCellProjection(cell) });
export const cropCellAddress = (position: BlockPosition) => ({
  componentId: CROP_CELL_COMPONENT,
  target: { kind: 'voxel' as const, position: [...position] as [number, number, number] },
});
const same = (a: readonly number[], b: readonly number[]) => a.every((value, axis) => value === b[axis]);
export function validateCropCellProjection(raw: unknown): CropCellProjectionV1 {
  const value = raw as CropCellProjectionV1;
  if (value?.version !== 1) throw new TypeError('Crop cell projection is invalid.');
  const position = validateBlockPosition(value.position, 'Crop cell');
  let crop: CropRecord | null = null;
  if (value.crop !== null) {
    const source = value.crop;
    if (!source || !same(validateBlockPosition(source.position, 'Crop record'), position))
      throw new TypeError('Crop cell record position is invalid.');
    advanceCrop(source, 0, 10);
    crop = Object.freeze({
      position: Object.freeze([...position]) as BlockPosition,
      stage: source.stage,
      subSeconds: source.subSeconds,
    });
  }
  return Object.freeze({ version: 1, position, crop });
}
export type CropInteractionCandidateV1 = Readonly<{
  version: 1;
  kind: 'crop-plant' | 'crop-harvest' | 'crop-fertilize';
  action: CropAction;
  actorId: string;
  actorReference: BlockActorProjectionV1['reference'];
  hit: BlockVoxelProjectionV1;
  adjacent: BlockVoxelProjectionV1;
  above: BlockVoxelProjectionV1;
  cell: CropCellProjectionV1;
  nextCrop: CropRecord | null;
  slots: BlockActorProjectionV1['slots'];
  creative: boolean;
  result: Readonly<{ version: 1; success: true; action: CropAction; actorId: string }>;
}>;
export function buildCropInteractionCandidate(
  action: CropAction,
  items: ItemDefinitionRegistry,
  config: CropInteractionConfig,
  rawActor: unknown,
  rawHit: unknown,
  rawAdjacent: unknown,
  rawAbove: unknown,
  rawCell: unknown,
  rawInput: unknown,
): CropInteractionCandidateV1 {
  const actor = validateBlockActorProjection(rawActor, items),
    hit = validateBlockVoxelProjection(rawHit),
    adjacent = validateBlockVoxelProjection(rawAdjacent),
    above = validateBlockVoxelProjection(rawAbove),
    cell = validateCropCellProjection(rawCell);
  const input = rawInput as {
    version?: unknown;
    trigger?: unknown;
    target?: { kind?: unknown; hit?: unknown; adjacent?: unknown };
  };
  if (input?.version !== 1 || input.trigger !== 'voxel' || input.target?.kind !== 'voxel')
    throw new TypeError('Crop planting input is invalid.');
  const inputHit = validateBlockPosition(input.target.hit, 'Crop hit'),
    inputAdjacent = validateBlockPosition(input.target.adjacent, 'Crop adjacent');
  if (
    !same(hit.position, inputHit) ||
    !same(adjacent.position, inputAdjacent) ||
    !same(above.position, [inputHit[0], inputHit[1] + 1, inputHit[2]]) ||
    !same(cell.position, inputHit) ||
    inputHit.reduce((sum, value, axis) => sum + Math.abs(value - inputAdjacent[axis]), 0) !== 1
  )
    throw new TypeError('Crop planting target does not match observations.');
  if (actor.lifecycle !== 'alive') throw new Error('player-dead');
  if (!config.soilVoxels.includes(hit.voxel)) throw new Error('invalid-farmland');
  if (!config.emptyAboveVoxels.includes(above.voxel)) throw new Error('crop-above-occupied');
  const creative = actor.mode.value === 'creative';
  const inventory = createInventoryCandidate(items, actor.slots);
  const selected = creative
    ? actor.creativeCatalog.hotbar[actor.creativeCatalog.selectedSlot]
    : inventory.slot(actor.equipment.selectedSlot)?.itemId;
  let nextCrop: CropRecord | null;
  if (action === 'plant') {
    if (cell.crop) throw new Error('occupied');
    if (selected !== config.seedItemId) throw new Error('requires-seeds');
    if (!creative) inventory.removeFromSlot(actor.equipment.selectedSlot, 1);
    nextCrop = Object.freeze({ position: Object.freeze([...hit.position]) as BlockPosition, stage: 0, subSeconds: 0 });
  } else {
    if (!cell.crop) throw new Error('missing-crop');
    if (action === 'fertilize') {
      if (!config.fertilizer || selected !== config.fertilizer.itemId) throw new Error('requires-fertilizer');
      if (cell.crop.stage === 7) throw new Error('crop-mature');
      if (!creative) inventory.removeFromSlot(actor.equipment.selectedSlot, 1);
      nextCrop = Object.freeze({
        position: Object.freeze([...hit.position]) as BlockPosition,
        stage: Math.min(7, cell.crop.stage + config.fertilizer.growthStages),
        subSeconds: 0,
      });
    } else {
      const harvest = harvestCrop(cell.crop, config);
      if (!creative && !harvest.drops.every((drop) => inventory.add(drop))) throw new Error('inventory-full');
      nextCrop = null;
    }
  }
  return Object.freeze({
    version: 1,
    kind: `crop-${action}`,
    action,
    actorId: actor.reference.entityId,
    actorReference: actor.reference,
    hit,
    adjacent,
    above,
    cell,
    nextCrop,
    slots: Object.freeze(inventory.snapshot()),
    creative,
    result: Object.freeze({ version: 1, success: true, action, actorId: actor.reference.entityId }),
  });
}
export const isCropInteractionCandidate = (raw: unknown): raw is CropInteractionCandidateV1 =>
  Boolean(
    raw &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    ['crop-plant', 'crop-harvest', 'crop-fertilize'].includes(String((raw as { kind?: unknown }).kind)),
  );
