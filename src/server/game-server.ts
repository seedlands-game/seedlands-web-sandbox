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
import { commitWorldEditBatch, compareChunkKeys } from './world-transaction-commit';

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
    return commitWorldEditBatch(
      {
        getChunk: (cx, cy, cz) => this.getChunk(cx, cy, cz),
        getRevision: () => this.revision,
        setRevision: (revision) => {
          this.revision = revision;
        },
        addMutationCount: (count) => {
          this.appliedMutationCount += count;
        },
        commitSingleEdit: (actorId, x, y, z, value) => this.commitSingleEdit(actorId, x, y, z, value),
      },
      batch,
    );
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
