import type { BlockHostOptions } from './block-host-commit';
import type { createBlockStatePort } from './block-state-port';
import type { FluidContainerInteractionCandidateV1 } from './fluid-container-interaction';
import type { SoilTransformInteractionCandidateV1 } from './soil-transform-interaction';
import type { WorldCommitResult } from '../../game-server-types';
import { prepareEntityMutation } from '../prepared-entity-mutation';
import { playerInteractionOrigin, positionsInRange, voxelCenter } from '../gameplay-geometry';

type Candidate = FluidContainerInteractionCandidateV1 | SoilTransformInteractionCandidateV1;
type Participant = Readonly<{ validate(): void; apply(): void }>;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export const voxelInteractionCells = (candidate: Candidate) => {
  const cells = [candidate.hit, candidate.adjacent, ...(candidate.kind === 'soil-transform' ? [candidate.above] : [])];
  return cells.filter((cell, index) => cells.findIndex((other) => same(other.position, cell.position)) === index);
};

/** Shared world/inventory participants; the registered host rederives each Pack-owned candidate first. */
export function prepareVoxelInteractionCommit(
  options: BlockHostOptions,
  projections: ReturnType<typeof createBlockStatePort>,
  prepareReceipt: (commit: WorldCommitResult) => Participant,
  candidate: Candidate,
  validateActorExecution: () => void,
) {
  const id = candidate.actorId;
  const currentActor = projections.actor(id);
  const cells = voxelInteractionCells(candidate).map((cell) => projections.voxel(cell.position));
  const entity = options.entities.get(id);
  const stale = candidate.kind === 'fluid-container' ? 'fluid-interaction-stale' : 'soil-interaction-stale';
  const validateCondition = () => {
    validateActorExecution();
    if (!entity) throw new Error('out-of-range');
    const origin = playerInteractionOrigin(entity.position);
    if (
      !positionsInRange(origin, voxelCenter([...candidate.hit.position]), 5) ||
      !positionsInRange(origin, voxelCenter([...candidate.adjacent.position]), 5)
    )
      throw new Error('out-of-range');
    if (
      !same(projections.actor(id), currentActor) ||
      cells.some((cell) => !same(projections.voxel(cell.position), cell))
    )
      throw new Error(stale);
  };
  validateCondition();
  const world = options.prepareVoxelEdit(id, [...candidate.targetPosition], candidate.toVoxel);
  if (!world.committed) throw new Error('world-not-changed');
  const components = options.entities.actorComponentSnapshot(id);
  const inventoryChanged = !same(currentActor.slots, candidate.slots);
  const mutation = prepareEntityMutation(options.entities, {
    actors: [
      {
        reference: candidate.actorReference,
        health: options.entities.playerStateAccess(id).health,
        components: { ...components, inventory: [...candidate.slots] },
      },
    ],
  });
  const equippedChanged = !same(
    currentActor.slots[currentActor.equipment.selectedSlot],
    candidate.slots[currentActor.equipment.selectedSlot],
  );
  const cancellation = equippedChanged ? options.simulation().prepareCancellation([id], 'slot-changed') : undefined;
  const receipt = prepareReceipt(world.result);
  return {
    parts: [mutation, ...(cancellation ? [cancellation] : []), world, receipt],
    value: { ...candidate.result, commit: { worldRevision: world.result.worldRevision } },
    inventoryChanged,
    validateCondition,
  };
}
