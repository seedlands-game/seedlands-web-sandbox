import {
  CHUNK_SIZE,
  chunkKey,
  floorDiv,
  mod,
  remeshChunkKeysForEdit,
  voxelIndex,
  type ChunkCoord,
} from '../world/voxel';
import type {
  ServerChunk,
  VoxelRegionChanged,
  WorldCommitResult,
  WorldEditBatch,
  WorldSemanticEvent,
} from './game-server';
import { assertMutationCoordinate, assertVoxelValue, type WorldMutationBuffer } from './world-mutation';

type ChunkMutationPlan = ChunkCoord & {
  key: string;
  sparse?: Map<number, number>;
  denseValues?: Uint16Array;
  denseTouched?: Uint8Array;
  touchedIndices: number[];
  chunk?: ServerChunk;
  changes?: Array<{ index: number; value: number; x: number; y: number; z: number }>;
};

type UniqueChunkMutationPlan = ChunkCoord & {
  key: string;
  runs: Array<{ start: number; end: number }>;
  chunk?: ServerChunk;
  changeCount: number;
  changedIndices?: Uint32Array;
  changedValues?: Uint16Array;
  meshOffsets: Uint8Array;
};

type TransactionState = {
  getChunk: (cx: number, cy: number, cz: number) => ServerChunk;
  getRevision: () => number;
  setRevision: (revision: number) => void;
  addMutationCount: (count: number) => void;
  commitSingleEdit: (actorId: string, x: number, y: number, z: number, value: number) => WorldCommitResult;
};

type CommitResultInput = {
  startedAt: number;
  validationFinishedAt: number;
  resolveFinishedAt: number;
  applyFinishedAt: number;
  inputMutationCount: number;
  mutationPayloadBytes: number;
  mutationCapacityBytes: number;
  structuralChange: VoxelRegionChanged | null;
  semanticEvents: WorldSemanticEvent[];
};

const compareChunkCoordinates = (left: ChunkCoord, right: ChunkCoord): number =>
  left.cx < right.cx
    ? -1
    : left.cx > right.cx
      ? 1
      : left.cy < right.cy
        ? -1
        : left.cy > right.cy
          ? 1
          : left.cz < right.cz
            ? -1
            : left.cz > right.cz
              ? 1
              : 0;

const chunkCoordinatesFromKey = (key: string): ChunkCoord => {
  const [cx, cy, cz] = key.split(',').map(Number);
  return { cx, cy, cz };
};

export const compareChunkKeys = (left: string, right: string): number =>
  compareChunkCoordinates(chunkCoordinatesFromKey(left), chunkCoordinatesFromKey(right));

const coordinateFromIndex = (plan: ChunkCoord, index: number): [number, number, number] => {
  const x = index % CHUNK_SIZE;
  const yz = Math.floor(index / CHUNK_SIZE);
  const z = yz % CHUNK_SIZE;
  const y = Math.floor(yz / CHUNK_SIZE);
  return [plan.cx * CHUNK_SIZE + x, plan.cy * CHUNK_SIZE + y, plan.cz * CHUNK_SIZE + z];
};

const buildResult = (revision: number, input: CommitResultInput): WorldCommitResult => {
  const committed = input.structuralChange !== null || input.semanticEvents.length > 0;
  return {
    committed,
    worldRevision: revision,
    structuralChange: input.structuralChange,
    semanticEvents: input.semanticEvents,
    metrics: {
      timingStatus: 'measured',
      inputMutationCount: input.inputMutationCount,
      canonicalWriteCount: input.structuralChange?.mutationCount ?? 0,
      dirtyChunkCount: input.structuralChange?.chunks.length ?? 0,
      meshInvalidationCount: input.structuralChange?.meshChunks.length ?? 0,
      structuralEventCount: input.structuralChange ? 1 : 0,
      semanticEventCount: input.semanticEvents.length,
      mutationPayloadBytes: input.mutationPayloadBytes,
      mutationCapacityBytes: input.mutationCapacityBytes,
      validationMs: input.validationFinishedAt - input.startedAt,
      resolveMs: input.resolveFinishedAt - input.validationFinishedAt,
      applyMs: input.applyFinishedAt - input.resolveFinishedAt,
      commitMs: input.applyFinishedAt - input.startedAt,
    },
  };
};

export function commitWorldEditBatch(state: TransactionState, batch: WorldEditBatch): WorldCommitResult {
  const singleEditFastPath =
    batch.edits?.length === 1 && batch.buffers === undefined && (batch.semanticEvents?.length ?? 0) === 0;
  const startedAt = singleEditFastPath ? 0 : performance.now();
  if (!batch.actorId.trim()) throw new TypeError('World edit actorId must not be empty.');
  if (batch.edits !== undefined && batch.buffers !== undefined)
    throw new TypeError('World edit batch cannot contain both edits and buffers.');
  const semanticInputs = batch.semanticEvents ?? [];
  for (const event of semanticInputs) {
    if (!event.type.trim()) throw new TypeError('Semantic event type must not be empty.');
    if (!event.subjectId.trim()) throw new TypeError('Semantic event subjectId must not be empty.');
  }

  let inputMutationCount = 0;
  let mutationPayloadBytes = 0;
  let mutationCapacityBytes = 0;
  let buffers: WorldMutationBuffer[] | null = null;
  if (batch.edits !== undefined) {
    for (const edit of batch.edits) {
      assertMutationCoordinate(edit.x);
      assertMutationCoordinate(edit.y);
      assertMutationCoordinate(edit.z);
      assertVoxelValue(edit.value);
    }
    inputMutationCount = batch.edits.length;
    mutationPayloadBytes = inputMutationCount * 14;
    mutationCapacityBytes = mutationPayloadBytes;
  } else if (batch.buffers !== undefined) {
    const identities = new Set<string>();
    for (const buffer of batch.buffers) {
      const identity = `${buffer.priority}\u0000${buffer.sourceId}`;
      if (identities.has(identity)) throw new TypeError(`Duplicate mutation buffer identity: ${buffer.sourceId}.`);
      identities.add(identity);
      inputMutationCount += buffer.count;
      mutationPayloadBytes += buffer.payloadBytes;
      mutationCapacityBytes += buffer.capacityBytes;
    }
    buffers = [...batch.buffers].sort((left, right) =>
      left.priority < right.priority
        ? -1
        : left.priority > right.priority
          ? 1
          : left.sourceId < right.sourceId
            ? -1
            : left.sourceId > right.sourceId
              ? 1
              : 0,
    );
  }
  const validationFinishedAt = singleEditFastPath ? startedAt : performance.now();

  if (singleEditFastPath) {
    const edit = batch.edits![0];
    return state.commitSingleEdit(batch.actorId, edit.x, edit.y, edit.z, edit.value);
  }
  if (buffers?.length === 1 && buffers[0].hasUniqueCoordinates && semanticInputs.length === 0)
    return commitUniqueBuffer(state, {
      actorId: batch.actorId,
      buffer: buffers[0],
      startedAt,
      validationFinishedAt,
    });

  const dense = inputMutationCount >= 512;
  const plansByKey = new Map<string, ChunkMutationPlan>();
  const addCandidate = (x: number, y: number, z: number, value: number) => {
    const cx = floorDiv(x, CHUNK_SIZE);
    const cy = floorDiv(y, CHUNK_SIZE);
    const cz = floorDiv(z, CHUNK_SIZE);
    const key = chunkKey(cx, cy, cz);
    let plan = plansByKey.get(key);
    if (!plan) {
      plan = {
        key,
        cx,
        cy,
        cz,
        ...(dense
          ? { denseValues: new Uint16Array(CHUNK_SIZE ** 3), denseTouched: new Uint8Array(CHUNK_SIZE ** 3) }
          : { sparse: new Map<number, number>() }),
        touchedIndices: [],
      };
      plansByKey.set(key, plan);
    }
    const index = voxelIndex(mod(x, CHUNK_SIZE), mod(y, CHUNK_SIZE), mod(z, CHUNK_SIZE));
    if (plan.denseValues && plan.denseTouched) {
      if (plan.denseTouched[index] === 0) {
        plan.denseTouched[index] = 1;
        plan.touchedIndices.push(index);
      }
      plan.denseValues[index] = value;
    } else {
      plan.sparse?.set(index, value);
    }
  };
  if (batch.edits) batch.edits.forEach(({ x, y, z, value }) => addCandidate(x, y, z, value));
  else buffers?.forEach((buffer) => buffer.forEach(addCandidate));

  const plans = [...plansByKey.values()].sort(compareChunkCoordinates);
  for (const plan of plans) plan.chunk = state.getChunk(plan.cx, plan.cy, plan.cz);
  const changedPlans: ChunkMutationPlan[] = [];
  const meshChunks = new Set<string>();
  let canonicalWriteCount = 0;
  let min: [number, number, number] | null = null;
  let max: [number, number, number] | null = null;
  for (const plan of plans) {
    const entries = plan.denseValues
      ? plan.touchedIndices
          .sort((left, right) => left - right)
          .map((index) => [index, plan.denseValues![index]] as const)
      : [...(plan.sparse?.entries() ?? [])].sort(([left], [right]) => left - right);
    const changes: NonNullable<ChunkMutationPlan['changes']> = [];
    for (const [index, value] of entries) {
      if (plan.chunk!.voxels[index] === value) continue;
      const [x, y, z] = coordinateFromIndex(plan, index);
      changes.push({ index, value, x, y, z });
      canonicalWriteCount += 1;
      remeshChunkKeysForEdit(x, y, z).forEach((key) => meshChunks.add(key));
      min = min ? [Math.min(min[0], x), Math.min(min[1], y), Math.min(min[2], z)] : [x, y, z];
      max = max ? [Math.max(max[0], x), Math.max(max[1], y), Math.max(max[2], z)] : [x, y, z];
    }
    if (changes.length) {
      plan.changes = changes;
      changedPlans.push(plan);
    }
  }

  const committed = canonicalWriteCount > 0 || semanticInputs.length > 0;
  const worldRevision = committed ? state.getRevision() + 1 : state.getRevision();
  const semanticEvents = semanticInputs.map((event) => ({ ...event, worldRevision }));
  const structuralChange: VoxelRegionChanged | null = canonicalWriteCount
    ? {
        type: 'voxel-region-changed',
        actorId: batch.actorId,
        worldRevision,
        mutationCount: canonicalWriteCount,
        chunks: changedPlans.map((plan) => plan.key),
        chunkRevisions: changedPlans.map((plan) => ({ key: plan.key, revision: plan.chunk!.revision + 1 })),
        meshChunks: [...meshChunks].sort(compareChunkKeys),
        bounds: min && max ? { min, max } : null,
      }
    : null;
  const resolveFinishedAt = performance.now();

  for (const plan of changedPlans) {
    for (const change of plan.changes!) plan.chunk!.voxels[change.index] = change.value;
    plan.chunk!.revision += 1;
    plan.chunk!.dirty = true;
    plan.chunk!.materialized = true;
  }
  if (committed) state.setRevision(worldRevision);
  state.addMutationCount(canonicalWriteCount);
  const applyFinishedAt = performance.now();
  return buildResult(state.getRevision(), {
    startedAt,
    validationFinishedAt,
    resolveFinishedAt,
    applyFinishedAt,
    inputMutationCount,
    mutationPayloadBytes,
    mutationCapacityBytes,
    structuralChange,
    semanticEvents,
  });
}

function commitUniqueBuffer(
  state: TransactionState,
  input: { actorId: string; buffer: WorldMutationBuffer; startedAt: number; validationFinishedAt: number },
): WorldCommitResult {
  const plansByKey = new Map<string, UniqueChunkMutationPlan>();
  for (const run of input.buffer.chunkRuns) {
    const key = chunkKey(run.cx, run.cy, run.cz);
    let plan = plansByKey.get(key);
    if (!plan) {
      plan = { key, cx: run.cx, cy: run.cy, cz: run.cz, runs: [], changeCount: 0, meshOffsets: new Uint8Array(27) };
      plansByKey.set(key, plan);
    }
    plan.runs.push({ start: run.start, end: run.end });
  }
  const plans = [...plansByKey.values()].sort(compareChunkCoordinates);
  for (const plan of plans) {
    plan.chunk = state.getChunk(plan.cx, plan.cy, plan.cz);
    const capacity = plan.runs.reduce((count, run) => count + run.end - run.start, 0);
    plan.changedIndices = new Uint32Array(capacity);
    plan.changedValues = new Uint16Array(capacity);
  }

  const changedPlans: UniqueChunkMutationPlan[] = [];
  const meshChunks = new Set<string>();
  let canonicalWriteCount = 0;
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (const plan of plans) {
    const originX = plan.cx * CHUNK_SIZE;
    const originY = plan.cy * CHUNK_SIZE;
    const originZ = plan.cz * CHUNK_SIZE;
    for (const run of plan.runs)
      input.buffer.forEachRange(run.start, run.end, (x, y, z, value) => {
        const localX = x - originX;
        const localY = y - originY;
        const localZ = z - originZ;
        const index = voxelIndex(localX, localY, localZ);
        if (plan.chunk!.voxels[index] === value) return;
        plan.changedIndices![plan.changeCount] = index;
        plan.changedValues![plan.changeCount] = value;
        plan.changeCount += 1;
        canonicalWriteCount += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
        const minDx = localX === 0 ? -1 : 0;
        const maxDx = localX === CHUNK_SIZE - 1 ? 1 : 0;
        const minDy = localY === 0 ? -1 : 0;
        const maxDy = localY === CHUNK_SIZE - 1 ? 1 : 0;
        const minDz = localZ === 0 ? -1 : 0;
        const maxDz = localZ === CHUNK_SIZE - 1 ? 1 : 0;
        for (let dx = minDx; dx <= maxDx; dx += 1)
          for (let dy = minDy; dy <= maxDy; dy += 1)
            for (let dz = minDz; dz <= maxDz; dz += 1) plan.meshOffsets[(dx + 1) * 9 + (dy + 1) * 3 + dz + 1] = 1;
      });
    if (plan.changeCount > 0) {
      changedPlans.push(plan);
      for (let offset = 0; offset < plan.meshOffsets.length; offset += 1) {
        if (plan.meshOffsets[offset] === 0) continue;
        const dx = Math.floor(offset / 9) - 1;
        const dy = Math.floor((offset % 9) / 3) - 1;
        const dz = (offset % 3) - 1;
        meshChunks.add(chunkKey(plan.cx + dx, plan.cy + dy, plan.cz + dz));
      }
    }
  }

  const worldRevision = canonicalWriteCount > 0 ? state.getRevision() + 1 : state.getRevision();
  const structuralChange: VoxelRegionChanged | null = canonicalWriteCount
    ? {
        type: 'voxel-region-changed',
        actorId: input.actorId,
        worldRevision,
        mutationCount: canonicalWriteCount,
        chunks: changedPlans.map((plan) => plan.key),
        chunkRevisions: changedPlans.map((plan) => ({ key: plan.key, revision: plan.chunk!.revision + 1 })),
        meshChunks: [...meshChunks].sort(compareChunkKeys),
        bounds: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
      }
    : null;
  const resolveFinishedAt = performance.now();
  for (const plan of changedPlans) {
    for (let index = 0; index < plan.changeCount; index += 1)
      plan.chunk!.voxels[plan.changedIndices![index]] = plan.changedValues![index];
    plan.chunk!.revision += 1;
    plan.chunk!.dirty = true;
    plan.chunk!.materialized = true;
  }
  if (structuralChange) state.setRevision(worldRevision);
  state.addMutationCount(canonicalWriteCount);
  const applyFinishedAt = performance.now();
  return buildResult(state.getRevision(), {
    startedAt: input.startedAt,
    validationFinishedAt: input.validationFinishedAt,
    resolveFinishedAt,
    applyFinishedAt,
    inputMutationCount: input.buffer.count,
    mutationPayloadBytes: input.buffer.payloadBytes,
    mutationCapacityBytes: input.buffer.capacityBytes,
    structuralChange,
    semanticEvents: [],
  });
}
