import type { ObservedModState, RegisteredCommitContext } from '../../composition/operation-contracts';
import { assertActorResourceExecution } from '../../composition/secondary-resource-authorization';
import { prepareEntityMutation } from '../prepared-entity-mutation';
import { playerInteractionOrigin, positionsInRange, voxelCenter, voxelAdjacentFacePoint } from '../gameplay-geometry';
import { traceVoxelRay } from '../voxel-ray';
import type { BlockHostOptions } from './block-host-commit';
import type { createBlockStatePort } from './block-state-port';
import { BLOCK_ACTOR_RESOURCE, BLOCK_VOXEL_RESOURCE, blockActorAddress, blockVoxelAddress } from './block-action-model';
import {
  CROP_INTERACTION_CAPABILITY,
  buildCropPlantCandidate,
  cropCellAddress,
  type CropInteractionConfig,
  type CropPlantCandidateV1,
} from './crop-interaction-model';
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function prepareCropPlantCommit(
  options: BlockHostOptions,
  projections: ReturnType<typeof createBlockStatePort>,
  observed: readonly ObservedModState[],
  execution: RegisteredCommitContext,
) {
  const context = execution.context;
  if (
    context.kind !== 'actor' ||
    context.target.kind !== 'voxel' ||
    execution.resource !== BLOCK_VOXEL_RESOURCE ||
    !options.crops
  )
    throw new TypeError('Crop planting requires its actor and crop owner.');
  const id = context.originalActorId,
    config = options.composition.capability<CropInteractionConfig>(CROP_INTERACTION_CAPABILITY),
    candidate = execution.candidateValue as CropPlantCandidateV1;
  const cells = [candidate.hit, candidate.adjacent, candidate.above].filter(
    (cell, index, all) => all.findIndex((other) => same(other.position, cell.position)) === index,
  );
  const addresses = [
    blockActorAddress(id),
    ...cells.map((cell) => blockVoxelAddress(cell.position)),
    cropCellAddress(candidate.cell.position),
  ];
  if (
    addresses.length !== observed.length ||
    addresses.some((address) => !observed.some((entry) => same(entry.address, address)))
  )
    throw new TypeError('Crop observation scope mismatch.');
  const actor = projections.actor(id),
    hit = projections.voxel(candidate.hit.position),
    adjacent = projections.voxel(candidate.adjacent.position),
    above = projections.voxel(candidate.above.position),
    crop = projections.crop(candidate.cell.position);
  const expected = buildCropPlantCandidate(
    options.content.items,
    config,
    actor,
    hit,
    adjacent,
    above,
    crop,
    execution.effectiveInput,
  );
  if (
    config.plantOperationId !== execution.operationId ||
    candidate.actorId !== id ||
    !same(candidate, expected) ||
    !same(context.target.position, candidate.hit.position)
  )
    throw new Error('crop-interaction-stale');
  const validateCondition = () => {
    assertActorResourceExecution(options.composition, execution.authorizer, context, BLOCK_ACTOR_RESOURCE);
    const entity = options.entities.get(id);
    if (
      !entity ||
      !positionsInRange(playerInteractionOrigin(entity.position), voxelCenter([...hit.position]), 5) ||
      !positionsInRange(playerInteractionOrigin(entity.position), voxelCenter([...adjacent.position]), 5)
    )
      throw new Error('out-of-range');
    if (
      !same(projections.actor(id), actor) ||
      cells.some((cell) => !same(projections.voxel(cell.position), cell)) ||
      !same(projections.crop(crop.position), crop)
    )
      throw new Error('crop-interaction-stale');
    const origin = playerInteractionOrigin(entity.position);
    for (const point of [
      voxelAdjacentFacePoint(hit.position, adjacent.position),
      voxelCenter([...adjacent.position]),
    ]) {
      const visibility = traceVoxelRay(
        point,
        origin,
        (x, y, z) => options.getVoxel([x, y, z]),
        (voxel) => options.content.voxelSemantics.get(voxel)?.solid ?? true,
      );
      if (visibility !== 'clear') throw new Error(visibility === 'unavailable' ? 'chunk-unavailable' : 'blocked');
    }
  };
  validateCondition();
  const cropMutation = options.crops().preparePlant(crop.position, crop.crop, candidate.nextCrop);
  const inventoryChanged = !same(actor.slots, candidate.slots);
  const components = options.entities.actorComponentSnapshot(id);
  const mutation = inventoryChanged
    ? prepareEntityMutation(options.entities, {
        actors: [
          {
            reference: candidate.actorReference,
            health: options.entities.playerStateAccess(id).health,
            components: { ...components, inventory: [...candidate.slots] },
          },
        ],
      })
    : undefined;
  const cancellation = inventoryChanged ? options.simulation().prepareCancellation([id], 'slot-changed') : undefined;
  return {
    parts: [...(mutation ? [mutation] : []), ...(cancellation ? [cancellation] : []), cropMutation],
    value: candidate.result,
    inventoryChanged,
    validateCondition,
  };
}
