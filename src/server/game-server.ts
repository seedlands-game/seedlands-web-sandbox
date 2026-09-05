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
} from '../world/voxel';
import type { ChunkPersistence, ChunkSnapshot } from './persistence/chunk-persistence';
import type { GameplayPersistence } from './persistence/gameplay-persistence';
import { createChunkSnapshot } from './persistence/create-chunk-snapshot';
import { GameServerGameplayFacade } from './game-server-gameplay';
import { createStarterEcology } from './simulation/starter-ecology';
import { assertMutationCoordinate, assertVoxelValue } from './world-mutation';
import { commitWorldEditBatch, compareChunkKeys } from './world-transaction-commit';
import type { FluidAdvanceResult, FluidCell } from './fluid/voxel-fluid-runtime';
import { FluidActiveWindow } from './fluid/fluid-active-window';
import { FluidChunkAccess } from './fluid/fluid-chunk-access';
import { FluidChunkActivationQueue } from './fluid/fluid-chunk-activation-queue';
import { hasAdjacentWater, legacyFluid } from './fluid/fluid-cell-state';
import {
  captureBatchFluidState,
  commitBatchFluidSidecars,
  readFluidCell,
  readFluidChunk,
} from './fluid/fluid-edit-sidecars';
import { commitFluidCandidate } from './fluid/fluid-candidate-commit';
import { FluidTransactionRuntime } from './fluid/fluid-transaction-runtime';
import type { FluidCandidate } from './fluid/fluid-transaction';
import { findDryStarterSurface } from './starter-surface';
import { peekLoadedVoxel } from './loaded-voxel-reader';

export type { VoxelEdit } from './world-mutation';
export type * from './game-server-types';
import type {
  DerivedMeshSnapshot,
  GameServerOptions,
  ServerChunk,
  VoxelRegionChanged,
  WorkerCanonicalResult,
  WorkerMeshPreparation,
  WorldCommitMetrics,
  WorldCommitResult,
  WorldEditBatch,
  WorldSemanticEvent,
} from './game-server-types';

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
  readonly generatorVersion: number;
  private readonly chunks = new Map<string, ServerChunk>();
  private clock = 0;
  private accessSequence = 0;
  private readonly persistence?: ChunkPersistence & Partial<GameplayPersistence>;
  private revision = 0;
  private appliedMutationCount = 0;
  private readonly fluidRuntime: FluidTransactionRuntime<WorldCommitResult>;
  private readonly fluidChunks: FluidChunkAccess;
  private readonly fluidChunkActivations = new FluidChunkActivationQueue();
  private readonly fluidWindow = new FluidActiveWindow();

  constructor(readonly options: GameServerOptions) {
    super(options.persistence);
    this.seed = normalizeSeed(options.seedText);
    this.generatorVersion = options.generatorVersion ?? GENERATOR_VERSION;
    if (this.generatorVersion !== 2 && this.generatorVersion !== GENERATOR_VERSION)
      throw new Error(`Unsupported generator version ${this.generatorVersion}.`);
    this.persistence = options.persistence;
    this.fluidChunks = new FluidChunkAccess(this.chunks, (cx, cy, cz) => this.getChunk(cx, cy, cz));
    this.fluidRuntime = new FluidTransactionRuntime({
      epoch: 1,
      readChunk: (key) => readFluidChunk(key, (candidate) => this.fluidWindow.allowsKey(candidate), this.chunks),
      readCell: (position) =>
        readFluidCell(position, (x, y, z) => this.fluidWindow.allowsPosition(x, y, z), this.chunks),
      apply: (candidate) => this.applyFluidCandidate(candidate),
    });
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
          fluid: snapshot.fluid?.slice() ?? legacyFluid(snapshot.voxels),
        }
      : {
          key,
          cx,
          cy,
          cz,
          voxels: makeChunk(this.seed, cx, cy, cz, [], this.generatorVersion),
          revision: 0,
          persistedRevision: 0,
          dirty: false,
          materialized: false,
          accessEpoch: ++this.accessSequence,
          fluid: new Uint8Array(CHUNK_SIZE ** 3),
        };
    if (!restored) chunk.fluid = legacyFluid(chunk.voxels);
    this.chunks.set(key, chunk);
    if (this.fluidWindow.allowsKey(key)) this.fluidChunkActivations.schedule(chunk);
    return chunk;
  }

  async ensureChunkNeighborhood(cx: number, cy: number, cz: number): Promise<void> {
    let alreadyResident = true;
    for (let y = Math.max(0, cy - 1); y <= Math.min(1, cy + 1); y += 1)
      for (let z = cz - 1; z <= cz + 1; z += 1)
        for (let x = cx - 1; x <= cx + 1; x += 1) if (!this.chunks.has(chunkKey(x, y, z))) alreadyResident = false;
    if (alreadyResident) return;
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

  peekLoadedVoxel(x: number, y: number, z: number) {
    return peekLoadedVoxel(this.chunks, x, y, z);
  }

  createDerivedMeshSnapshot(cx: number, cy: number, cz: number): DerivedMeshSnapshot {
    const chunk = this.getChunk(cx, cy, cz);
    const overlays: MeshAuthorityOverlay[] = [];
    for (let overlayY = cy - 1; overlayY <= cy + 1; overlayY += 1)
      for (let overlayZ = cz - 1; overlayZ <= cz + 1; overlayZ += 1)
        for (let overlayX = cx - 1; overlayX <= cx + 1; overlayX += 1) {
          if (overlayX === cx && overlayY === cy && overlayZ === cz) continue;
          const source = this.readAuthoritativeChunk(overlayX, overlayY, overlayZ);
          if (source)
            overlays.push({ cx: overlayX, cy: overlayY, cz: overlayZ, voxels: source.voxels, fluid: source.fluid });
        }
    const derived = createProceduralMeshInput({
      seed: this.seed,
      generatorVersion: this.generatorVersion,
      cx,
      cy,
      cz,
      canonical: chunk.voxels,
      fluid: chunk.fluid,
      overlays,
    });
    return {
      key: chunk.key,
      cx,
      cy,
      cz,
      canonical: chunk.voxels,
      halo: derived.halo,
      fluid: derived.fluid,
      fluidHalo: derived.fluidHalo,
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
            overlays.push({
              cx: overlayX,
              cy: overlayY,
              cz: overlayZ,
              voxels: source.voxels.slice(),
              fluid: source.fluid.slice(),
            });
        }
    return {
      key,
      cx,
      cy,
      cz,
      chunkRevision: center?.revision ?? 0,
      generatorVersion: this.generatorVersion,
      ...(center?.materialized ? { canonical: center.voxels.slice() } : {}),
      ...(center?.materialized ? { fluid: center.fluid.slice() } : {}),
      overlays,
    };
  }

  acceptWorkerCanonical(result: WorkerCanonicalResult): boolean {
    if (
      result.generatorVersion !== this.generatorVersion ||
      result.key !== chunkKey(result.cx, result.cy, result.cz) ||
      result.canonical.length !== CHUNK_SIZE ** 3 ||
      !result.canonical.every((value) => value >= Voxel.Air && value <= Voxel.Lantern)
    )
      return false;
    const current = this.chunks.get(result.key);
    if (current) {
      if (current.revision !== result.chunkRevision) return false;
      return current.voxels.every((value, index) => value === result.canonical[index]);
    }
    if (result.chunkRevision !== 0) return false;
    const accepted: ServerChunk = {
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
      fluid: legacyFluid(result.canonical),
    };
    this.chunks.set(result.key, accepted);
    if (this.fluidWindow.allowsKey(result.key)) this.fluidChunkActivations.schedule(accepted);
    return true;
  }

  edit(x: number, y: number, z: number, value: number, actorId = 'system'): WorldCommitResult {
    assertMutationCoordinate(x);
    assertMutationCoordinate(y);
    assertMutationCoordinate(z);
    assertVoxelValue(value);
    const previous = this.getVoxel(x, y, z);
    const previousFluid = previous === Voxel.Water ? this.fluidChunks.cell(x, y, z, true) : null;
    const result = this.commitSingleEdit(actorId, x, y, z, value);
    if (result.committed) {
      this.fluidWindow.includeEditedPosition(x, y, z);
      this.fluidChunks.write(x, y, z, value === Voxel.Water ? { level: 8, source: true } : null);
      if (
        previous === Voxel.Water ||
        value === Voxel.Water ||
        hasAdjacentWater((...at) => this.fluidChunks.peekVoxel(...at), x, y, z)
      )
        this.fluidRuntime.activate([x, y, z]);
      if (previousFluid?.source && value !== Voxel.Water) this.fluidRuntime.removeSource([x, y, z]);
    }
    return result;
  }

  advanceFluid(seconds: number): FluidAdvanceResult {
    this.fluidChunkActivations.pumpRuntime(this.fluidRuntime, this.fluidChunks);
    return this.fluidRuntime.advance(seconds);
  }

  setFluidActiveChunks(keys: readonly string[]): void {
    this.fluidChunkActivations.sync(keys, this.chunks);
    this.fluidWindow.update(keys);
  }

  getFluidCell(x: number, y: number, z: number): FluidCell | null {
    return this.getVoxel(x, y, z) === Voxel.Water
      ? (this.fluidChunks.cell(x, y, z, true) ?? { level: 8, source: true })
      : null;
  }

  editBatch(batch: WorldEditBatch): WorldCommitResult {
    const previousFluid = captureBatchFluidState(batch, {
      getVoxel: (x, y, z) => this.getVoxel(x, y, z),
      getCell: (x, y, z) => this.fluidChunks.cell(x, y, z, true),
    });
    const result = commitWorldEditBatch(
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
    if (result.committed)
      commitBatchFluidSidecars(previousFluid, {
        getVoxel: (x, y, z) => this.getVoxel(x, y, z),
        includeEditedPosition: (x, y, z) => this.fluidWindow.includeEditedPosition(x, y, z),
        writeCell: (x, y, z, cell) => this.fluidChunks.write(x, y, z, cell),
        peekVoxel: (x, y, z) => this.fluidChunks.peekVoxel(x, y, z),
        activate: (position) => this.fluidRuntime.activate(position),
        removeSource: (position) => this.fluidRuntime.removeSource(position),
      });
    return result;
  }

  private applyFluidCandidate(candidate: FluidCandidate): WorldCommitResult {
    return commitFluidCandidate({
      candidate,
      chunks: this.chunks,
      worldRevision: this.revision,
      setWorldRevision: (revision) => {
        this.revision = revision;
      },
      addMutationCount: (count) => {
        this.appliedMutationCount += count;
      },
    });
  }

  private commitSingleEdit(actorId: string, x: number, y: number, z: number, value: number): WorldCommitResult {
    const cx = floorDiv(x, CHUNK_SIZE);
    const cy = floorDiv(y, CHUNK_SIZE);
    const cz = floorDiv(z, CHUNK_SIZE);
    const chunk = this.getChunk(cx, cy, cz);
    const index = voxelIndex(mod(x, CHUNK_SIZE), mod(y, CHUNK_SIZE), mod(z, CHUNK_SIZE));
    if (chunk.voxels[index] === value) {
      return {
        committed: false,
        worldRevision: this.revision,
        structuralChange: null,
        semanticEvents: EMPTY_SEMANTIC_EVENTS,
        metrics: SINGLE_EDIT_NOOP_METRICS,
      };
    }
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
    const snapshots = dirty.map((chunk) => createChunkSnapshot(this.options.seedText, chunk));
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
    return findDryStarterSurface(this.seed, this.generatorVersion, x, z, (...position) => this.getVoxel(...position));
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
      (snapshot.fluid === undefined ||
        (snapshot.fluidVersion === 1 &&
          snapshot.fluid.length === CHUNK_SIZE ** 3 &&
          snapshot.fluid.every((value) => value === 0 || ((value & 0x0f) >= 1 && (value & 0x0f) <= 8)))) &&
      snapshot.voxels.every((value) => value >= Voxel.Air && value <= Voxel.Lantern)
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
      fluid: snapshot.fluid?.slice() ?? legacyFluid(snapshot.voxels),
    };
    this.chunks.set(key, restored);
    this.fluidChunkActivations.schedule(restored);
    return restored;
  }
}
