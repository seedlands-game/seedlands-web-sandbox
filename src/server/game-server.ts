import { createProceduralMeshInput, makeChunk, type MeshAuthorityOverlay } from '../world/mesh';
import {
  CHUNK_SIZE,
  GENERATOR_VERSION,
  chunkKey,
  floorDiv,
  mod,
  normalizeSeed,
  remeshChunkKeysForEdit,
  voxelIndex,
  Voxel,
  type ChunkCoord,
} from '../world/voxel';
import type { ChunkPersistence, ChunkSnapshot } from './persistence/chunk-persistence';
import { WorldMutationBuffer, assertMutationCoordinate, assertVoxelValue, type VoxelEdit } from './world-mutation';

export type { VoxelEdit } from './world-mutation';

export type ServerChunk = ChunkCoord & {
  key: string;
  voxels: Uint16Array;
  revision: number;
  dirty: boolean;
  materialized: boolean;
};

export type WorldSemanticEventInput = { type: string; subjectId: string; data?: unknown };
export type WorldSemanticEvent = WorldSemanticEventInput & { worldRevision: number };
export type WorldEditBatch = {
  actorId: string;
  edits?: readonly VoxelEdit[];
  buffers?: readonly WorldMutationBuffer[];
  semanticEvents?: readonly WorldSemanticEventInput[];
};
export type VoxelRegionChanged = {
  type: 'voxel-region-changed';
  actorId: string;
  worldRevision: number;
  mutationCount: number;
  chunks: string[];
  chunkRevisions: Array<{ key: string; revision: number }>;
  meshChunks: string[];
  bounds: { min: [number, number, number]; max: [number, number, number] } | null;
};
export type WorldCommitMetrics = {
  // Single-voxel commits skip wall-clock probes so instrumentation cannot regress the hot path.
  timingStatus: 'measured' | 'not-collected-hot-path';
  inputMutationCount: number;
  canonicalWriteCount: number;
  dirtyChunkCount: number;
  meshInvalidationCount: number;
  structuralEventCount: 0 | 1;
  semanticEventCount: number;
  mutationPayloadBytes: number;
  mutationCapacityBytes: number;
  validationMs: number;
  resolveMs: number;
  applyMs: number;
  commitMs: number;
};
export type WorldCommitResult = {
  committed: boolean;
  worldRevision: number;
  structuralChange: VoxelRegionChanged | null;
  semanticEvents: readonly WorldSemanticEvent[];
  metrics: WorldCommitMetrics;
};
export type ServerEntity = { id: string; kind: string; position: [number, number, number] };
export type EntityCreate = Omit<ServerEntity, 'id'> & { id?: string };
export type EntityUpdate = Partial<Omit<ServerEntity, 'id'>>;
export type GameServerOptions = { seedText: string; persistence?: ChunkPersistence };
export type DerivedMeshSnapshot = {
  key: string;
  cx: number;
  cy: number;
  cz: number;
  canonical: Uint16Array;
  halo: Uint16Array;
  chunkRevision: number;
  haloRevision: string;
  proceduralVoxelSamples: number;
  macroContextCount: number;
};
export type WorkerMeshPreparation = {
  key: string;
  cx: number;
  cy: number;
  cz: number;
  chunkRevision: number;
  generatorVersion: number;
  canonical?: Uint16Array;
  overlays: MeshAuthorityOverlay[];
};
export type WorkerCanonicalResult = Pick<
  WorkerMeshPreparation,
  'key' | 'cx' | 'cy' | 'cz' | 'chunkRevision' | 'generatorVersion'
> & { canonical: Uint16Array };

const snapshotFromChunk = (seedText: string, chunk: ServerChunk): ChunkSnapshot => ({
  key: chunk.key,
  seedText,
  cx: chunk.cx,
  cy: chunk.cy,
  cz: chunk.cz,
  generatorVersion: GENERATOR_VERSION,
  revision: chunk.revision,
  voxels: chunk.voxels.slice(),
});

const EMPTY_SEMANTIC_EVENTS: readonly WorldSemanticEvent[] = Object.freeze([]);
const singleEditMetrics = (canonicalWriteCount: 0 | 1, meshInvalidationCount: number): WorldCommitMetrics => ({
  timingStatus: 'not-collected-hot-path',
  inputMutationCount: 1,
  canonicalWriteCount,
  dirtyChunkCount: canonicalWriteCount,
  meshInvalidationCount,
  structuralEventCount: canonicalWriteCount,
  semanticEventCount: 0,
  mutationPayloadBytes: 14,
  mutationCapacityBytes: 14,
  validationMs: 0,
  resolveMs: 0,
  applyMs: 0,
  commitMs: 0,
});
const SINGLE_EDIT_NOOP_METRICS = Object.freeze(singleEditMetrics(0, 0));
const SINGLE_EDIT_METRICS = Array.from({ length: 9 }, (_, meshInvalidationCount) =>
  Object.freeze(singleEditMetrics(1, meshInvalidationCount)),
);

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

const compareChunkKeys = (left: string, right: string): number =>
  compareChunkCoordinates(chunkCoordinatesFromKey(left), chunkCoordinatesFromKey(right));

const coordinateFromIndex = (plan: ChunkCoord, index: number): [number, number, number] => {
  const x = index % CHUNK_SIZE;
  const yz = Math.floor(index / CHUNK_SIZE);
  const z = yz % CHUNK_SIZE;
  const y = Math.floor(yz / CHUNK_SIZE);
  return [plan.cx * CHUNK_SIZE + x, plan.cy * CHUNK_SIZE + y, plan.cz * CHUNK_SIZE + z];
};

export class GameServer {
  readonly seed: number;
  readonly generatorVersion = GENERATOR_VERSION;
  private readonly chunks = new Map<string, ServerChunk>();
  private readonly entities = new Map<string, ServerEntity>();
  private entitySequence = 0;
  private clock = 0;
  private readonly persistence?: ChunkPersistence;
  private revision = 0;
  private appliedMutationCount = 0;

  constructor(readonly options: GameServerOptions) {
    this.seed = normalizeSeed(options.seedText);
    this.persistence = options.persistence;
  }

  get worldTime(): number {
    return this.clock;
  }

  get materializedChunkCount(): number {
    return [...this.chunks.values()].filter((chunk) => chunk.materialized).length;
  }

  get mutationCount(): number {
    return this.appliedMutationCount;
  }

  get worldRevision(): number {
    return this.revision;
  }

  getChunk(cx: number, cy: number, cz: number): ServerChunk {
    const key = chunkKey(cx, cy, cz);
    const existing = this.chunks.get(key);
    if (existing) return existing;
    const snapshot = this.persistence?.loadSnapshot(key);
    const restored = snapshot && this.isValidSnapshot(snapshot, key, cx, cy, cz);
    const chunk: ServerChunk = restored
      ? { key, cx, cy, cz, voxels: snapshot.voxels, revision: snapshot.revision, dirty: false, materialized: true }
      : {
          key,
          cx,
          cy,
          cz,
          voxels: makeChunk(this.seed, cx, cy, cz, []),
          revision: 0,
          dirty: false,
          materialized: false,
        };
    this.chunks.set(key, chunk);
    return chunk;
  }

  getVoxel(x: number, y: number, z: number): number {
    const cx = floorDiv(x, CHUNK_SIZE);
    const cy = floorDiv(y, CHUNK_SIZE);
    const cz = floorDiv(z, CHUNK_SIZE);
    const chunk = this.getChunk(cx, cy, cz);
    return chunk.voxels[voxelIndex(mod(x, CHUNK_SIZE), mod(y, CHUNK_SIZE), mod(z, CHUNK_SIZE))];
  }

  createDerivedMeshSnapshot(cx: number, cy: number, cz: number): DerivedMeshSnapshot {
    const chunk = this.getChunk(cx, cy, cz);
    const overlays: MeshAuthorityOverlay[] = [];
    for (let overlayY = cy - 1; overlayY <= cy + 1; overlayY += 1)
      for (let overlayZ = cz - 1; overlayZ <= cz + 1; overlayZ += 1)
        for (let overlayX = cx - 1; overlayX <= cx + 1; overlayX += 1) {
          if (overlayX === cx && overlayY === cy && overlayZ === cz) continue;
          const source = this.readAuthoritativeChunk(overlayX, overlayY, overlayZ);
          if (source) overlays.push({ cx: overlayX, cy: overlayY, cz: overlayZ, voxels: source.voxels });
        }
    const derived = createProceduralMeshInput({ seed: this.seed, cx, cy, cz, canonical: chunk.voxels, overlays });
    return {
      key: chunk.key,
      cx,
      cy,
      cz,
      canonical: chunk.voxels,
      halo: derived.halo,
      chunkRevision: chunk.revision,
      haloRevision: derived.haloRevision,
      proceduralVoxelSamples: derived.proceduralVoxelSamples,
      macroContextCount: derived.macroContextCount,
    };
  }

  prepareWorkerMeshInput(cx: number, cy: number, cz: number): WorkerMeshPreparation {
    const key = chunkKey(cx, cy, cz);
    const center = this.readAuthoritativeChunk(cx, cy, cz);
    const overlays: MeshAuthorityOverlay[] = [];
    for (let overlayY = cy - 1; overlayY <= cy + 1; overlayY += 1)
      for (let overlayZ = cz - 1; overlayZ <= cz + 1; overlayZ += 1)
        for (let overlayX = cx - 1; overlayX <= cx + 1; overlayX += 1) {
          if (overlayX === cx && overlayY === cy && overlayZ === cz) continue;
          const source = this.readAuthoritativeChunk(overlayX, overlayY, overlayZ);
          if (source?.materialized)
            overlays.push({ cx: overlayX, cy: overlayY, cz: overlayZ, voxels: source.voxels.slice() });
        }
    return {
      key,
      cx,
      cy,
      cz,
      chunkRevision: center?.revision ?? 0,
      generatorVersion: this.generatorVersion,
      ...(center?.materialized ? { canonical: center.voxels.slice() } : {}),
      overlays,
    };
  }

  acceptWorkerCanonical(result: WorkerCanonicalResult): boolean {
    if (
      result.generatorVersion !== this.generatorVersion ||
      result.key !== chunkKey(result.cx, result.cy, result.cz) ||
      result.canonical.length !== CHUNK_SIZE ** 3 ||
      !result.canonical.every((value) => value >= Voxel.Air && value <= Voxel.Water)
    )
      return false;
    const current = this.chunks.get(result.key);
    if (current) {
      if (current.revision !== result.chunkRevision) return false;
      return current.voxels.every((value, index) => value === result.canonical[index]);
    }
    if (result.chunkRevision !== 0) return false;
    this.chunks.set(result.key, {
      key: result.key,
      cx: result.cx,
      cy: result.cy,
      cz: result.cz,
      voxels: result.canonical,
      revision: 0,
      dirty: false,
      materialized: false,
    });
    return true;
  }

  edit(x: number, y: number, z: number, value: number): WorldCommitResult {
    assertMutationCoordinate(x);
    assertMutationCoordinate(y);
    assertMutationCoordinate(z);
    assertVoxelValue(value);
    return this.commitSingleEdit('system', x, y, z, value);
  }

  editBatch(batch: WorldEditBatch): WorldCommitResult {
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
      return this.commitSingleEdit(batch.actorId, edit.x, edit.y, edit.z, edit.value);
    }

    if (buffers?.length === 1 && buffers[0].hasUniqueCoordinates && semanticInputs.length === 0)
      return this.commitUniqueBuffer({
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
    for (const plan of plans) plan.chunk = this.getChunk(plan.cx, plan.cy, plan.cz);

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
    const worldRevision = committed ? this.revision + 1 : this.revision;
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
    if (committed) this.revision = worldRevision;
    this.appliedMutationCount += canonicalWriteCount;
    const applyFinishedAt = performance.now();
    return this.commitResult({
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

  private commitResult(input: {
    startedAt: number;
    validationFinishedAt: number;
    resolveFinishedAt: number;
    applyFinishedAt: number;
    inputMutationCount: number;
    mutationPayloadBytes: number;
    mutationCapacityBytes: number;
    structuralChange: VoxelRegionChanged | null;
    semanticEvents: WorldSemanticEvent[];
    timingStatus?: WorldCommitMetrics['timingStatus'];
  }): WorldCommitResult {
    const committed = input.structuralChange !== null || input.semanticEvents.length > 0;
    return {
      committed,
      worldRevision: this.revision,
      structuralChange: input.structuralChange,
      semanticEvents: input.semanticEvents,
      metrics: {
        timingStatus: input.timingStatus ?? 'measured',
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
  }

  private commitSingleEdit(actorId: string, x: number, y: number, z: number, value: number): WorldCommitResult {
    const cx = floorDiv(x, CHUNK_SIZE);
    const cy = floorDiv(y, CHUNK_SIZE);
    const cz = floorDiv(z, CHUNK_SIZE);
    const chunk = this.getChunk(cx, cy, cz);
    const index = voxelIndex(mod(x, CHUNK_SIZE), mod(y, CHUNK_SIZE), mod(z, CHUNK_SIZE));
    if (chunk.voxels[index] === value)
      return {
        committed: false,
        worldRevision: this.revision,
        structuralChange: null,
        semanticEvents: EMPTY_SEMANTIC_EVENTS,
        metrics: SINGLE_EDIT_NOOP_METRICS,
      };
    const worldRevision = this.revision + 1;
    const meshChunks = remeshChunkKeysForEdit(x, y, z);
    if (meshChunks.length > 1) meshChunks.sort(compareChunkKeys);
    const structuralChange: VoxelRegionChanged = {
      type: 'voxel-region-changed',
      actorId,
      worldRevision,
      mutationCount: 1,
      chunks: [chunk.key],
      chunkRevisions: [{ key: chunk.key, revision: chunk.revision + 1 }],
      meshChunks,
      bounds: { min: [x, y, z], max: [x, y, z] },
    };
    chunk.voxels[index] = value;
    chunk.revision += 1;
    chunk.dirty = true;
    chunk.materialized = true;
    this.revision = worldRevision;
    this.appliedMutationCount += 1;
    return {
      committed: true,
      worldRevision,
      structuralChange,
      semanticEvents: EMPTY_SEMANTIC_EVENTS,
      metrics: SINGLE_EDIT_METRICS[meshChunks.length],
    };
  }

  private commitUniqueBuffer(input: {
    actorId: string;
    buffer: WorldMutationBuffer;
    startedAt: number;
    validationFinishedAt: number;
  }): WorldCommitResult {
    const plansByKey = new Map<string, UniqueChunkMutationPlan>();
    for (const run of input.buffer.chunkRuns) {
      const key = chunkKey(run.cx, run.cy, run.cz);
      let plan = plansByKey.get(key);
      if (!plan) {
        plan = {
          key,
          cx: run.cx,
          cy: run.cy,
          cz: run.cz,
          runs: [],
          changeCount: 0,
          meshOffsets: new Uint8Array(27),
        };
        plansByKey.set(key, plan);
      }
      plan.runs.push({ start: run.start, end: run.end });
    }
    const plans = [...plansByKey.values()].sort(compareChunkCoordinates);
    for (const plan of plans) {
      plan.chunk = this.getChunk(plan.cx, plan.cy, plan.cz);
      const capacity = plan.runs.reduce((count, run) => count + run.end - run.start, 0);
      plan.changedIndices = new Uint32Array(capacity);
      plan.changedValues = new Uint16Array(capacity);
    }

    const changedPlans: UniqueChunkMutationPlan[] = [];
    const meshChunks = new Set<string>();
    let canonicalWriteCount = 0;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
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

    const worldRevision = canonicalWriteCount > 0 ? this.revision + 1 : this.revision;
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
    if (structuralChange) this.revision = worldRevision;
    this.appliedMutationCount += canonicalWriteCount;
    const applyFinishedAt = performance.now();
    return this.commitResult({
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

  flushDirtyChunks(): string[] {
    const dirty = [...this.chunks.values()].filter((chunk) => chunk.dirty);
    if (!dirty.length) return [];
    if (!this.persistence) return [];
    this.persistence.saveSnapshots(dirty.map((chunk) => snapshotFromChunk(this.options.seedText, chunk)));
    dirty.forEach((chunk) => {
      chunk.dirty = false;
    });
    return dirty.map((chunk) => chunk.key);
  }

  createEntity(entity: EntityCreate): ServerEntity {
    const id = entity.id ?? `entity-${++this.entitySequence}`;
    if (this.entities.has(id)) throw new Error(`Entity already exists: ${id}`);
    const created: ServerEntity = { id, kind: entity.kind, position: [...entity.position] as [number, number, number] };
    this.entities.set(id, created);
    return { ...created, position: [...created.position] as [number, number, number] };
  }

  getEntity(id: string): ServerEntity | null {
    const entity = this.entities.get(id);
    return entity ? { ...entity, position: [...entity.position] as [number, number, number] } : null;
  }

  updateEntity(id: string, update: EntityUpdate): ServerEntity {
    const entity = this.entities.get(id);
    if (!entity) throw new Error(`Unknown entity: ${id}`);
    if (update.kind !== undefined) entity.kind = update.kind;
    if (update.position !== undefined) entity.position = [...update.position] as [number, number, number];
    return { ...entity, position: [...entity.position] as [number, number, number] };
  }

  advanceClock(hours: number): number {
    this.clock = (((this.clock + hours) % 24) + 24) % 24;
    return this.clock;
  }

  setWorldTime(hours: number): number {
    this.clock = ((hours % 24) + 24) % 24;
    return this.clock;
  }

  private isValidSnapshot(snapshot: ChunkSnapshot, key: string, cx: number, cy: number, cz: number): boolean {
    return (
      snapshot.seedText === this.options.seedText &&
      snapshot.generatorVersion === this.generatorVersion &&
      snapshot.key === key &&
      snapshot.cx === cx &&
      snapshot.cy === cy &&
      snapshot.cz === cz &&
      Number.isInteger(snapshot.revision) &&
      snapshot.revision >= 0 &&
      snapshot.voxels.length === CHUNK_SIZE ** 3 &&
      snapshot.voxels.every((value) => value >= Voxel.Air && value <= Voxel.Water)
    );
  }

  private readAuthoritativeChunk(cx: number, cy: number, cz: number): ServerChunk | undefined {
    const key = chunkKey(cx, cy, cz);
    const existing = this.chunks.get(key);
    if (existing) return existing;
    const snapshot = this.persistence?.loadSnapshot(key);
    if (!snapshot || !this.isValidSnapshot(snapshot, key, cx, cy, cz)) return undefined;
    const restored: ServerChunk = {
      key,
      cx,
      cy,
      cz,
      voxels: snapshot.voxels,
      revision: snapshot.revision,
      dirty: false,
      materialized: true,
    };
    this.chunks.set(key, restored);
    return restored;
  }
}
