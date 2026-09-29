import { CHUNK_SIZE, chunkKey, floorDiv } from '../../world/voxel';
import {
  enqueueFluidCleanupPosition,
  enqueueFluidEditPosition,
  prepareFluidEditQueueState,
  type FluidEditQueueState,
} from './fluid-edit-effect-plan';
import type { FluidAuthoritySnapshot, FluidCandidate, FluidPosition } from './fluid-transaction';

const chunkKeyFor = ([x, y, z]: FluidPosition) =>
  chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE));

/** Builds the complete no-fail queue replacement before the canonical world commit. */
export function prepareFluidCandidateSettlement(
  current: FluidEditQueueState,
  candidate: FluidCandidate,
  lease: FluidAuthoritySnapshot,
): FluidEditQueueState {
  const leasedCount = lease.frontier.length + (lease.cleanupFrontier?.length ?? 0);
  const next = prepareFluidEditQueueState(
    { ...current, leasedCount: Math.max(0, current.leasedCount - leasedCount) },
    [],
    'ordinary',
  );
  for (const position of candidate.nextFrontier) enqueueFluidEditPosition(next, position, 'ordinary');
  for (const position of candidate.nextCleanupFrontier ?? []) enqueueFluidCleanupPosition(next, position);
  if (candidate.needsRescan)
    for (const position of [...candidate.consumedFrontier, ...(candidate.consumedCleanupFrontier ?? [])]) {
      const key = chunkKeyFor(position);
      if (!next.rescanJobs.has(key)) next.rescanJobs.set(key, 0);
    }
  return next;
}
