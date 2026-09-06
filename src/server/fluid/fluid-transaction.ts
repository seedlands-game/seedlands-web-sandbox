import { CHUNK_SIZE, chunkKey, floorDiv, mod, voxelIndex, Voxel } from '../../world/voxel';
import { isFluidCandidateResultValid } from './fluid-candidate-validator';
import { FluidPriorityFrontier } from './fluid-priority-frontier';

export const FLUID_TRANSACTION_PROTOCOL_VERSION = 1 as const;
export const FLUID_FRONTIER_BATCH_SIZE = 128;
const CLEANUP_FRONTIER_BATCH_SIZE = FLUID_FRONTIER_BATCH_SIZE / 2;
const INTERACTIVE_FRONTIER_BATCH_SIZE = FLUID_FRONTIER_BATCH_SIZE / 4;
const RESCAN_SCAN_BUDGET = FLUID_FRONTIER_BATCH_SIZE;

export type FluidPosition = readonly [number, number, number];
export type FluidActivationPriority = 'ordinary' | 'interactive';
export type FluidCellValue = { voxel: number; fluid: number };
export type FluidChunkSnapshot = {
  key: string;
  cx: number;
  cy: number;
  cz: number;
  revision: number;
  voxels: Uint16Array;
  fluid: Uint8Array;
};
export type FluidReadSetEntry = { key: string; revision: number };
export type FluidAuthoritySnapshot = {
  protocolVersion: typeof FLUID_TRANSACTION_PROTOCOL_VERSION;
  epoch: number;
  workId: string;
  frontier: FluidPosition[];
  cleanupFrontier?: FluidPosition[];
  chunks: FluidChunkSnapshot[];
};
export type FluidCellWrite = {
  position: FluidPosition;
  expectedVoxel: number;
  expectedFluid: number;
  voxel: number;
  fluid: number;
};
export type FluidCandidate = {
  protocolVersion: typeof FLUID_TRANSACTION_PROTOCOL_VERSION;
  epoch: number;
  workId: string;
  readSet: FluidReadSetEntry[];
  writes: FluidCellWrite[];
  consumedFrontier: FluidPosition[];
  consumedCleanupFrontier?: FluidPosition[];
  nextFrontier: FluidPosition[];
  nextCleanupFrontier?: FluidPosition[];
  needsRescan: boolean;
};
export type FluidCandidateCommit =
  | { accepted: true; commitSequence: number }
  | { accepted: false; reason: 'epoch' | 'work-id' | 'read-set' | 'invalid-result' | 'cell-conflict' };
export type FluidAuthorityDiagnostics = Readonly<{
  pendingCellCount: number;
  inFlightLeaseCount: number;
  acceptedCandidateCount: number;
  rejectedCandidateCount: number;
  returnedLeaseCount: number;
}>;

const MIN_ACTIVE_Y = 0;
const MAX_ACTIVE_Y = 63;
const positionKey = ([x, y, z]: FluidPosition) => `${x},${y},${z}`;
const positionFromKey = (key: string): FluidPosition => key.split(',').map(Number) as [number, number, number];
const comparePositions = (left: FluidPosition, right: FluidPosition) =>
  left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
const compareChunkKeys = (left: string, right: string) => {
  const [leftX, leftY, leftZ] = left.split(',').map(Number);
  const [rightX, rightY, rightZ] = right.split(',').map(Number);
  return leftX - rightX || leftY - rightY || leftZ - rightZ;
};
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
const chunkKeyFor = ([x, y, z]: FluidPosition) =>
  chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE));
const indexFor = ([x, y, z]: FluidPosition) => voxelIndex(mod(x, CHUNK_SIZE), mod(y, CHUNK_SIZE), mod(z, CHUNK_SIZE));
const isActivePosition = (position: FluidPosition) => position[1] >= MIN_ACTIVE_Y && position[1] <= MAX_ACTIVE_Y;
const cloneChunk = (chunk: FluidChunkSnapshot): FluidChunkSnapshot => ({
  ...chunk,
  voxels: chunk.voxels.slice(),
  fluid: chunk.fluid.slice(),
});
const fluidForWater = (fluid: number) => fluid || 0x88;

/**
 * Computes one bounded propagation candidate from transferred data only. It has
 * no authority callbacks, so a compute worker cannot accidentally read live
 * GameServer state while producing its candidate.
 */
export function computeFluidCandidate(snapshot: FluidAuthoritySnapshot): FluidCandidate {
  if (snapshot.protocolVersion !== FLUID_TRANSACTION_PROTOCOL_VERSION)
    throw new TypeError('Unsupported fluid protocol.');
  const chunks = new Map(snapshot.chunks.map((chunk) => [chunk.key, cloneChunk(chunk)]));
  const original = new Map<string, FluidCellValue>();
  const touched = new Set<string>();
  const next = new Set<string>();
  const nextCleanup = new Set<string>();
  let needsRescan = false;
  let unknownReadCount = 0;

  const read = (position: FluidPosition): FluidCellValue | undefined => {
    const chunk = chunks.get(chunkKeyFor(position));
    if (!chunk) {
      needsRescan = true;
      unknownReadCount += 1;
      return undefined;
    }
    const index = indexFor(position);
    return { voxel: chunk.voxels[index], fluid: chunk.fluid[index] };
  };
  const write = (position: FluidPosition, value: FluidCellValue) => {
    const chunk = chunks.get(chunkKeyFor(position));
    if (!chunk) {
      needsRescan = true;
      return;
    }
    const index = indexFor(position);
    const key = positionKey(position);
    if (!original.has(key)) original.set(key, { voxel: chunk.voxels[index], fluid: chunk.fluid[index] });
    chunk.voxels[index] = value.voxel;
    chunk.fluid[index] = value.fluid;
    touched.add(key);
  };
  const activate = (position: FluidPosition) => {
    if (isActivePosition(position)) next.add(positionKey(position));
  };
  const cell = (position: FluidPosition) => {
    const value = read(position);
    if (!value || value.voxel !== Voxel.Water) return value;
    return { ...value, fluid: fluidForWater(value.fluid) };
  };
  const suppliedLevel = (position: FluidPosition): number => {
    const [x, y, z] = position;
    const above = cell([x, y + 1, z]);
    if (above?.voxel === Voxel.Water) return 8;
    let best = 0;
    for (const candidate of horizontal(position)) {
      const neighbor = cell(candidate);
      if (neighbor?.voxel === Voxel.Water) best = Math.max(best, (neighbor.fluid & 0x0f) - 1);
    }
    return best;
  };
  const place = (position: FluidPosition, level: number) => {
    const previous = read(position);
    if (!previous) return;
    if (previous.voxel !== Voxel.Air && previous.voxel !== Voxel.Water) return;
    const nextFluid = Math.max(1, Math.min(8, level));
    if (previous.voxel === Voxel.Water && previous.fluid === nextFluid) return;
    write(position, { voxel: Voxel.Water, fluid: nextFluid });
    neighborhood(position).forEach(activate);
  };

  // Source removal is ordinary local relaxation. A cell only changes once its
  // one-cell dependency stencil is known, so an unloaded Chunk is never
  // interpreted as a dry neighbor and no authority-side component search is
  // required.
  for (const position of [...(snapshot.cleanupFrontier ?? []), ...snapshot.frontier]) {
    const current = cell(position);
    if (!current || current.voxel !== Voxel.Water) continue;
    const level = current.fluid & 0x0f;
    const source = (current.fluid & 0x80) !== 0;
    if (!source) {
      const unknownReadsBefore = unknownReadCount;
      let desired = suppliedLevel(position);
      const [x, y, z] = position;
      const above = cell([x, y + 1, z]);
      const strongerSide = horizontal(position).some((candidate) => {
        const neighbor = cell(candidate);
        return neighbor?.voxel === Voxel.Water && (neighbor.fluid & 0x0f) > level;
      });
      if (above?.voxel !== Voxel.Water && !strongerSide) desired = Math.min(desired, level - 1);
      // Unknown local cells may contain a stronger supporting source. They are
      // never proof that a current level can shrink; leave it intact and retry
      // after the authority can provide that one-hop dependency. A known local
      // source may still increase the level in this step.
      if (desired < level && unknownReadCount !== unknownReadsBefore) {
        activate(position);
        continue;
      }
      if (desired <= 0) {
        write(position, { voxel: Voxel.Air, fluid: 0 });
        neighborhood(position).forEach(activate);
        continue;
      }
      if (desired !== level) {
        write(position, { voxel: Voxel.Water, fluid: desired });
        neighborhood(position).forEach(activate);
      }
    }
    const [x, y, z] = position;
    const below: FluidPosition = [x, y - 1, z];
    const belowCell = cell(below);
    if (!belowCell) continue;
    if (belowCell.voxel === Voxel.Air) {
      place(below, 8);
      activate(position);
      continue;
    }
    if (belowCell.voxel === Voxel.Water) continue;
    const settled = cell(position);
    const settledLevel = settled ? settled.fluid & 0x0f : 0;
    if (settledLevel <= 1) continue;
    for (const target of horizontal(position)) {
      const targetCell = cell(target);
      if (!targetCell) continue;
      if (
        targetCell.voxel === Voxel.Air ||
        (targetCell.voxel === Voxel.Water &&
          (targetCell.fluid & 0x80) === 0 &&
          (targetCell.fluid & 0x0f) < settledLevel - 1)
      )
        place(target, settledLevel - 1);
    }
  }

  const writes = [...touched]
    .map((key) => {
      const position = positionFromKey(key);
      const before = original.get(key)!;
      const after = read(position)!;
      return {
        position,
        expectedVoxel: before.voxel,
        expectedFluid: before.fluid,
        voxel: after.voxel,
        fluid: after.fluid,
      };
    })
    .filter((write) => write.expectedVoxel !== write.voxel || write.expectedFluid !== write.fluid)
    .sort((left, right) => comparePositions(left.position, right.position));
  return {
    protocolVersion: FLUID_TRANSACTION_PROTOCOL_VERSION,
    epoch: snapshot.epoch,
    workId: snapshot.workId,
    readSet: snapshot.chunks
      .map(({ key, revision }) => ({ key, revision }))
      .sort((left, right) => compareChunkKeys(left.key, right.key)),
    writes,
    consumedFrontier: snapshot.frontier.map((position) => [...position] as FluidPosition),
    consumedCleanupFrontier: (snapshot.cleanupFrontier ?? []).map((position) => [...position] as FluidPosition),
    nextFrontier: [...next].map(positionFromKey).sort(comparePositions),
    nextCleanupFrontier: [...nextCleanup].map(positionFromKey).sort(comparePositions),
    needsRescan,
  };
}

type AuthorityOptions = {
  epoch: number;
  maxQueue?: number;
  readChunk(key: string): FluidChunkSnapshot | null;
  readCell(position: FluidPosition): FluidCellValue | null;
  apply(candidate: FluidCandidate): void;
};

/** Owns frontier leases and admission checks; writes remain in the authority's atomic apply callback. */
export class FluidTransactionAuthority {
  private readonly frontier = new FluidPriorityFrontier();
  private readonly cleanupFrontier: FluidPosition[] = [];
  private readonly cleanupQueued = new Set<string>();
  private readonly leases = new Map<string, FluidAuthoritySnapshot>();
  private readonly leaseInteractiveCounts = new Map<string, number>();
  private readonly rescanJobs = new Map<string, number>();
  private nextWorkId = 1;
  private nextCommitSequence = 1;
  private acceptedCandidateCount = 0;
  private rejectedCandidateCount = 0;
  private returnedLeaseCount = 0;
  private readonly maxQueue: number;

  constructor(private readonly options: AuthorityOptions) {
    this.maxQueue = options.maxQueue ?? 8_192;
  }

  get epoch(): number {
    return this.options.epoch;
  }

  get needsRescan(): readonly string[] {
    return [...this.rescanJobs.keys()].sort(compareChunkKeys);
  }

  get pending(): number {
    return (
      this.frontier.pending +
      this.cleanupFrontier.length +
      [...this.leases.values()].reduce(
        (count, lease) => count + lease.frontier.length + (lease.cleanupFrontier?.length ?? 0),
        0,
      )
    );
  }

  get diagnostics(): FluidAuthorityDiagnostics {
    return {
      pendingCellCount: this.pending,
      inFlightLeaseCount: this.leases.size,
      acceptedCandidateCount: this.acceptedCandidateCount,
      rejectedCandidateCount: this.rejectedCandidateCount,
      returnedLeaseCount: this.returnedLeaseCount,
    };
  }

  get leasedChunkKeys(): readonly string[] {
    return [...new Set([...this.leases.values()].flatMap((lease) => lease.chunks.map((chunk) => chunk.key)))].sort(
      compareChunkKeys,
    );
  }

  activate(position: FluidPosition, priority: FluidActivationPriority = 'ordinary'): boolean {
    let accepted = true;
    for (const candidate of neighborhood(position)) accepted = this.enqueue(candidate, priority) && accepted;
    return accepted;
  }

  removeSource(position: FluidPosition): boolean {
    let accepted = true;
    for (const candidate of horizontal(position)) accepted = this.enqueue(candidate) && accepted;
    return accepted;
  }

  requestFluidWork(): FluidAuthoritySnapshot | null {
    if (this.leases.size) return null;
    this.pumpRescans();
    const cleanupFrontier = this.cleanupFrontier.splice(0, CLEANUP_FRONTIER_BATCH_SIZE);
    cleanupFrontier.forEach((position) => this.cleanupQueued.delete(positionKey(position)));
    const remaining = FLUID_FRONTIER_BATCH_SIZE - cleanupFrontier.length;
    const { frontier, interactiveCount } = this.frontier.take(remaining, INTERACTIVE_FRONTIER_BATCH_SIZE);
    if (!frontier.length && !cleanupFrontier.length) return null;
    const chunkKeys = new Set<string>();
    for (const position of [...cleanupFrontier, ...frontier])
      for (const candidate of neighborhood(position)) chunkKeys.add(chunkKeyFor(candidate));
    const chunks = [...chunkKeys]
      .sort(compareChunkKeys)
      .map((key) => this.options.readChunk(key))
      .filter((chunk): chunk is FluidChunkSnapshot => chunk !== null)
      .map(cloneChunk);
    const snapshot: FluidAuthoritySnapshot = {
      protocolVersion: FLUID_TRANSACTION_PROTOCOL_VERSION,
      epoch: this.epoch,
      workId: `fluid-${this.epoch}-${this.nextWorkId++}`,
      frontier,
      cleanupFrontier,
      chunks,
    };
    this.leases.set(snapshot.workId, snapshot);
    this.leaseInteractiveCounts.set(snapshot.workId, interactiveCount);
    return snapshot;
  }

  commitFluidCandidate(candidate: FluidCandidate): FluidCandidateCommit {
    const lease = this.leases.get(candidate.workId);
    if (candidate.protocolVersion !== FLUID_TRANSACTION_PROTOCOL_VERSION || candidate.epoch !== this.epoch) {
      return this.rejectCandidate(lease, 'epoch');
    }
    if (
      !lease ||
      !sameFrontier(lease.frontier, candidate.consumedFrontier) ||
      !sameFrontier(lease.cleanupFrontier ?? [], candidate.consumedCleanupFrontier ?? [])
    ) {
      return this.rejectCandidate(lease, 'work-id');
    }
    if (!sameReadSet(lease, candidate.readSet)) {
      return this.rejectCandidate(lease, 'read-set');
    }
    if (
      candidate.readSet.some((entry) => {
        const chunk = this.options.readChunk(entry.key);
        return !chunk || chunk.revision !== entry.revision;
      })
    ) {
      return this.rejectCandidate(lease, 'read-set');
    }
    if (!isFluidCandidateResultValid(lease, candidate)) {
      return this.rejectCandidate(lease, 'invalid-result');
    }
    if (
      candidate.writes.some((write) => {
        const current = this.options.readCell(write.position);
        return !current || current.voxel !== write.expectedVoxel || current.fluid !== write.expectedFluid;
      })
    ) {
      return this.rejectCandidate(lease, 'cell-conflict');
    }
    this.options.apply(candidate);
    this.leases.delete(candidate.workId);
    this.leaseInteractiveCounts.delete(candidate.workId);
    candidate.nextFrontier.forEach((position) => this.enqueue(position));
    candidate.nextCleanupFrontier?.forEach((position) => this.enqueueCleanup(position));
    if (candidate.needsRescan)
      [...candidate.consumedFrontier, ...(candidate.consumedCleanupFrontier ?? [])].forEach((position) =>
        this.scheduleRescan(chunkKeyFor(position)),
      );
    this.acceptedCandidateCount += 1;
    return { accepted: true, commitSequence: this.nextCommitSequence++ };
  }

  abortLease(workId: string, _reason: string): boolean {
    const lease = this.leases.get(workId);
    if (!lease) return false;
    this.returnLease(lease);
    return true;
  }

  private enqueue(position: FluidPosition, priority: FluidActivationPriority = 'ordinary'): boolean {
    if (!isActivePosition(position)) return true;
    if (this.frontier.has(position)) {
      this.frontier.enqueue(position, priority);
      return true;
    }
    if (this.pending >= this.maxQueue) {
      this.scheduleRescan(chunkKeyFor(position));
      return false;
    }
    this.frontier.enqueue(position, priority);
    return true;
  }

  private enqueueCleanup(position: FluidPosition): boolean {
    if (!isActivePosition(position)) return true;
    const key = positionKey(position);
    if (this.cleanupQueued.has(key)) return true;
    if (this.pending >= this.maxQueue) {
      this.scheduleRescan(chunkKeyFor(position));
      return false;
    }
    this.cleanupQueued.add(key);
    this.cleanupFrontier.push([...position] as FluidPosition);
    return true;
  }

  private returnLease(lease: FluidAuthoritySnapshot): void {
    this.leases.delete(lease.workId);
    const interactiveCount = this.leaseInteractiveCounts.get(lease.workId) ?? 0;
    this.leaseInteractiveCounts.delete(lease.workId);
    this.returnedLeaseCount += 1;
    this.frontier.restore(lease.frontier, interactiveCount);
    for (let index = (lease.cleanupFrontier?.length ?? 0) - 1; index >= 0; index -= 1) {
      const position = lease.cleanupFrontier![index];
      const key = positionKey(position);
      if (this.cleanupQueued.has(key)) continue;
      this.cleanupQueued.add(key);
      this.cleanupFrontier.unshift(position);
    }
  }

  private rejectCandidate(
    lease: FluidAuthoritySnapshot | undefined,
    reason: Extract<FluidCandidateCommit, { accepted: false }>['reason'],
  ): FluidCandidateCommit {
    this.rejectedCandidateCount += 1;
    if (lease) this.returnLease(lease);
    return { accepted: false, reason };
  }

  private scheduleRescan(key: string): void {
    if (!this.rescanJobs.has(key)) this.rescanJobs.set(key, 0);
  }

  private pumpRescans(): void {
    let remaining = RESCAN_SCAN_BUDGET;
    for (const [key, cursor] of [...this.rescanJobs]) {
      if (!remaining || this.pending >= this.maxQueue) return;
      const chunk = this.options.readChunk(key);
      if (!chunk) continue;
      let nextCursor = cursor;
      while (nextCursor < chunk.voxels.length && remaining && this.pending < this.maxQueue) {
        if (chunk.voxels[nextCursor] === Voxel.Water) {
          const x = nextCursor % CHUNK_SIZE;
          const yz = Math.floor(nextCursor / CHUNK_SIZE);
          const z = yz % CHUNK_SIZE;
          const y = Math.floor(yz / CHUNK_SIZE);
          this.enqueue([chunk.cx * CHUNK_SIZE + x, chunk.cy * CHUNK_SIZE + y, chunk.cz * CHUNK_SIZE + z]);
        }
        nextCursor += 1;
        remaining -= 1;
      }
      if (nextCursor === chunk.voxels.length) this.rescanJobs.delete(key);
      else this.rescanJobs.set(key, nextCursor);
    }
  }
}

const sameFrontier = (left: readonly FluidPosition[], right: readonly FluidPosition[]) =>
  left.length === right.length && left.every((position, index) => positionKey(position) === positionKey(right[index]!));

const sameReadSet = (lease: FluidAuthoritySnapshot, readSet: readonly FluidReadSetEntry[]) => {
  const expected = lease.chunks
    .map(({ key, revision }) => ({ key, revision }))
    .sort((left, right) => compareChunkKeys(left.key, right.key));
  return (
    expected.length === readSet.length &&
    expected.every((entry, index) => entry.key === readSet[index]?.key && entry.revision === readSet[index]?.revision)
  );
};
