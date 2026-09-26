import { CHUNK_SIZE, chunkKey, floorDiv } from '../../world/voxel';
import { FluidPriorityFrontier } from './fluid-priority-frontier';
import type { FluidActivationPriority, FluidPosition } from './fluid-transaction';

export type FluidEditQueueState = {
  frontier: FluidPriorityFrontier;
  cleanupFrontier: FluidPosition[];
  cleanupQueued: Set<string>;
  rescanJobs: Map<string, number>;
  leasedCount: number;
  maxQueue: number;
};
export type FluidEditEffect = Readonly<{ position: FluidPosition; activate: boolean; removeSource: boolean }>;
export type PreparedFluidEditEffects = Readonly<{ validate(): void; apply(): void }>;

const MIN_ACTIVE_Y = 0;
const MAX_ACTIVE_Y = 63;
const positionKey = ([x, y, z]: FluidPosition) => `${x},${y},${z}`;
const chunkKeyFor = ([x, y, z]: FluidPosition) =>
  chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE));
const horizontal = ([x, y, z]: FluidPosition): FluidPosition[] => [
  [x - 1, y, z],
  [x + 1, y, z],
  [x, y, z - 1],
  [x, y, z + 1],
];
const neighborhood = ([x, y, z]: FluidPosition): FluidPosition[] => [
  [x, y, z],
  [x, y - 1, z],
  [x, y + 1, z],
  ...horizontal([x, y, z]),
];
const isActivePosition = (position: FluidPosition) => position[1] >= MIN_ACTIVE_Y && position[1] <= MAX_ACTIVE_Y;
const pending = (state: FluidEditQueueState) =>
  state.frontier.pending + state.cleanupFrontier.length + state.leasedCount;
const scheduleRescan = (state: FluidEditQueueState, position: FluidPosition) => {
  const key = chunkKeyFor(position);
  if (!state.rescanJobs.has(key)) state.rescanJobs.set(key, 0);
};

export function enqueueFluidEditPosition(
  state: FluidEditQueueState,
  position: FluidPosition,
  priority: FluidActivationPriority,
): boolean {
  if (!isActivePosition(position)) return true;
  if (state.frontier.has(position)) {
    state.frontier.enqueue(position, priority);
    return true;
  }
  if (pending(state) >= state.maxQueue) {
    scheduleRescan(state, position);
    return false;
  }
  state.frontier.enqueue(position, priority);
  return true;
}

export function enqueueFluidCleanupPosition(state: FluidEditQueueState, position: FluidPosition): boolean {
  if (!isActivePosition(position)) return true;
  const key = positionKey(position);
  if (state.cleanupQueued.has(key)) return true;
  if (pending(state) >= state.maxQueue) {
    scheduleRescan(state, position);
    return false;
  }
  state.cleanupQueued.add(key);
  state.cleanupFrontier.push([...position] as FluidPosition);
  return true;
}

export function prepareFluidEditQueueState(
  current: FluidEditQueueState,
  effects: readonly FluidEditEffect[],
  priority: FluidActivationPriority,
): FluidEditQueueState {
  const next: FluidEditQueueState = {
    frontier: current.frontier.clone(),
    cleanupFrontier: current.cleanupFrontier.map((position) => [...position] as FluidPosition),
    cleanupQueued: new Set(current.cleanupQueued),
    rescanJobs: new Map(current.rescanJobs),
    leasedCount: current.leasedCount,
    maxQueue: current.maxQueue,
  };
  for (const effect of effects) {
    if (effect.activate)
      neighborhood(effect.position).forEach((position) => enqueueFluidEditPosition(next, position, priority));
    if (effect.removeSource)
      horizontal(effect.position).forEach((position) => enqueueFluidEditPosition(next, position, 'ordinary'));
  }
  return next;
}

export function createPreparedFluidEditEffects(
  snapshot: () => FluidEditQueueState,
  install: (state: FluidEditQueueState) => void,
  effects: readonly FluidEditEffect[],
  priority: FluidActivationPriority,
): PreparedFluidEditEffects {
  let prepared = prepareFluidEditQueueState(snapshot(), effects, priority);
  let validated = false,
    used = false;
  return Object.freeze({
    validate() {
      if (used) throw new Error('Prepared fluid edit effects were already used.');
      validated = false;
      prepared = prepareFluidEditQueueState(snapshot(), effects, priority);
      validated = true;
    },
    apply() {
      if (!validated) throw new Error('Prepared fluid edit effects require validation.');
      used = true;
      install(prepared);
    },
  });
}
