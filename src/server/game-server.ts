import { createProceduralMeshInput, makeChunk, type MeshAuthorityOverlay } from '../world/mesh';
import {
  CHUNK_SIZE,
  GENERATOR_VERSION,
  chunkKey,
  floorDiv,
  mod,
  normalizeSeed,
  remeshChunkKeysForEdit,
  terrainHeight,
  voxelIndex,
  Voxel,
  isSolid,
  type ChunkCoord,
} from '../world/voxel';
import type { ChunkPersistence, ChunkSnapshot } from './persistence/chunk-persistence';
import type { GameplayPersistence } from './persistence/gameplay-persistence';
import { GameServerGameplayFacade } from './game-server-gameplay';
import type { EntitySpawn, GameplayEntity } from './gameplay/entity-store';
import { createStarterEcology } from './simulation/starter-ecology';
import { WorldMutationBuffer, assertMutationCoordinate, assertVoxelValue, type VoxelEdit } from './world-mutation';
import { commitWorldEditBatch, compareChunkKeys } from './world-transaction-commit';

export type { VoxelEdit } from './world-mutation';

export type ServerChunk = ChunkCoord & {
  key: string;
  voxels: Uint16Array;
  revision: number;
  persistedRevision: number;
  dirty: boolean;
  materialized: boolean;
  accessEpoch: number;
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
export type ServerEntity = GameplayEntity;
export type EntityCreate = EntitySpawn;
export type { EntityUpdate } from './gameplay/entity-store';
export type GameServerOptions = { seedText: string; persistence?: ChunkPersistence & Partial<GameplayPersistence> };
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

export class GameServer extends GameServerGameplayFacade {
  readonly seed: number;
  readonly generatorVersion = GENERATOR_VERSION;
  private readonly chunks = new Map<string, ServerChunk>();
  private clock = 0;
  private accessSequence = 0;
  private readonly persistence?: ChunkPersistence & Partial<GameplayPersistence>;
  private revision = 0;
  private appliedMutationCount = 0;

  constructor(readonly options: GameServerOptions) {
    super(options.persistence);
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
    if (existing) {
      existing.accessEpoch = ++this.accessSequence;
      return existing;
    }
    const snapshot = this.persistence?.loadSnapshot(key);
    const restored = snapshot && this.isValidSnapshot(snapshot, key, cx, cy, cz);
    const chunk: ServerChunk = restored
      ? {
          key,
          cx,
          cy,
          cz,
          voxels: snapshot.voxels,
          revision: snapshot.revision,
          persistedRevision: snapshot.revision,
          dirty: false,
          materialized: true,
          accessEpoch: ++this.accessSequence,
        }
      : {
          key,
          cx,
          cy,
          cz,
          voxels: makeChunk(this.seed, cx, cy, cz, []),
          revision: 0,
          persistedRevision: 0,
          dirty: false,
          materialized: false,
          accessEpoch: ++this.accessSequence,
        };
    this.chunks.set(key, chunk);
    return chunk;
  }

  async ensureChunkNeighborhood(cx: number, cy: number, cz: number): Promise<void> {
    await this.persistence?.ensureNeighborhood?.(cx, cy, cz);
  }

  releaseChunkNeighborhood(cx: number, cy: number, cz: number): void {
    this.persistence?.releaseNeighborhood?.(cx, cy, cz);
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
      persistedRevision: 0,
      dirty: false,
      materialized: false,
      accessEpoch: ++this.accessSequence,
    });
    return true;
  }

  edit(x: number, y: number, z: number, value: number, actorId = 'system'): WorldCommitResult {
    assertMutationCoordinate(x);
    assertMutationCoordinate(y);
    assertMutationCoordinate(z);
    assertVoxelValue(value);
    return this.commitSingleEdit(actorId, x, y, z, value);
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

  async flushDirtyChunks(): Promise<string[]> {
    const dirty = [...this.chunks.values()].filter((chunk) => chunk.dirty);
    if (!dirty.length) return [];
    if (!this.persistence) return [];
    const snapshots = dirty.map((chunk) => snapshotFromChunk(this.options.seedText, chunk));
    await this.persistence.saveSnapshots(snapshots);
    snapshots.forEach((snapshot) => {
      const chunk = this.chunks.get(snapshot.key);
      if (!chunk) return;
      chunk.persistedRevision = Math.max(chunk.persistedRevision, snapshot.revision);
      chunk.dirty = chunk.revision > chunk.persistedRevision;
    });
    return snapshots.map((snapshot) => snapshot.key);
  }

  async evictChunk(cx: number, cy: number, cz: number): Promise<boolean> {
    const key = chunkKey(cx, cy, cz);
    const chunk = this.chunks.get(key);
    if (!chunk) return true;
    const accessEpoch = chunk.accessEpoch;
    const revision = chunk.revision;
    if (chunk.dirty) await this.flushDirtyChunks();
    const current = this.chunks.get(key);
    if (
      current !== chunk ||
      current.accessEpoch !== accessEpoch ||
      current.revision !== revision ||
      current.dirty ||
      current.persistedRevision !== current.revision
    )
      return false;
    this.chunks.delete(key);
    this.persistence?.evictSnapshot?.(key);
    return true;
  }

  advanceClock(hours: number): number {
    this.clock = (((this.clock + hours) % 24) + 24) % 24;
    return this.clock;
  }

  setWorldTime(hours: number): number {
    this.clock = ((hours % 24) + 24) % 24;
    return this.clock;
  }

  initializeStarterEcology(center: [number, number, number]) {
    const current = this.simulationSnapshot();
    if (this.restoredGameplayVersion !== null || current.starterEcologyVersion > 0 || current.actors.length > 0)
      return { initialized: false as const, actorIds: [] as string[] };
    const layout = createStarterEcology(this.seed, center, (x, z, nearY) => this.findSurfaceAir(x, z, nearY));
    layout.pois.forEach((poi) => this.registerPoi(poi));
    const actors = layout.actors.map((actor) => this.spawnAutonomousActor(actor));
    this.spawnWorldItem(layout.foodPosition, { itemId: 'berry', count: 1 });
    const naturalEdits = layout.naturalEdits.filter((edit) => this.getVoxel(edit.x, edit.y, edit.z) === Voxel.Air);
    const commit = this.editBatch({
      actorId: 'starter-ecology-v1',
      edits: [...layout.campEdits, ...naturalEdits],
    });
    this.gameplay.simulation.starterEcologyVersion = layout.version;
    return { initialized: true as const, actorIds: actors.map((actor) => actor.id), commit };
  }

  private findSurfaceAir(x: number, z: number, _nearY: number): [number, number, number] {
    for (let radius = 0; radius <= 6; radius += 1)
      for (let dx = -radius; dx <= radius; dx += 1)
        for (let dz = -radius; dz <= radius; dz += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
          const candidateX = x + dx;
          const candidateZ = z + dz;
          const y = terrainHeight(this.seed, candidateX, candidateZ) + 1;
          if (
            isSolid(this.getVoxel(candidateX, y - 1, candidateZ)) &&
            this.getVoxel(candidateX, y, candidateZ) === Voxel.Air &&
            this.getVoxel(candidateX, y + 1, candidateZ) === Voxel.Air &&
            this.getVoxel(candidateX, y + 2, candidateZ) === Voxel.Air &&
            this.getVoxel(candidateX, y + 3, candidateZ) === Voxel.Air
          )
            return [candidateX + 0.5, y, candidateZ + 0.5];
        }
    throw new Error(`No dry starter surface found near ${x},${z}.`);
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
    if (existing) {
      existing.accessEpoch = ++this.accessSequence;
      return existing;
    }
    const snapshot = this.persistence?.loadSnapshot(key);
    if (!snapshot || !this.isValidSnapshot(snapshot, key, cx, cy, cz)) return undefined;
    const restored: ServerChunk = {
      key,
      cx,
      cy,
      cz,
      voxels: snapshot.voxels,
      revision: snapshot.revision,
      persistedRevision: snapshot.revision,
      dirty: false,
      materialized: true,
      accessEpoch: ++this.accessSequence,
    };
    this.chunks.set(key, restored);
    return restored;
  }
}
