import { restoreServerChunk } from './server-chunk-restore';
import { StationWorldResidency } from './station-world-residency';
import {
  assertNoRawStationEdits,
  assertStationCheckpointIntegrity,
  assertStationChunkIntegrity,
} from './station-world-integrity';
import { makeChunk } from '../world/mesh';
import { CHUNK_SIZE, GENERATOR_VERSION, chunkKey, normalizeSeed, Voxel, MAX_VOXEL_ID } from '../world/voxel';
import type { ChunkPersistence, ChunkPersistenceLoadDiagnostics, ChunkSnapshot } from './persistence/chunk-persistence';
import type { GameplayPersistence } from './persistence/gameplay-persistence';
import { GameServerGameplayFacade } from './game-server-gameplay';
import { initializeStarterEcologyBootstrap } from './starter-ecology-bootstrap';
import { assertMutationCoordinate, assertVoxelValue } from './world-mutation';
import { commitServerWorldEdit, prepareServerWorldEdit } from './world-edit-runtime';
import type { FluidCell } from './fluid/fluid-cell';
import { FluidActiveWindow } from './fluid/fluid-active-window';
import { FluidChunkAccess } from './fluid/fluid-chunk-access';
import { FluidChunkActivationQueue } from './fluid/fluid-chunk-activation-queue';
import { hasAdjacentWater, legacyFluid } from './fluid/fluid-cell-state';
import * as FluidSidecars from './fluid/fluid-edit-sidecars';
import { commitFluidCandidate } from './fluid/fluid-candidate-commit';
import { FluidTransactionRuntime } from './fluid/fluid-transaction-runtime';
import type { FluidCandidate } from './fluid/fluid-transaction';
import { peekLoadedVoxel } from './loaded-voxel-reader';
import { isValidChunkSnapshot } from './persistence/validate-chunk-snapshot';
import type { FrozenGameSaveSnapshot } from './persistence/game-save-snapshot';
import { GameSaveRuntime } from './persistence/game-save-runtime';
import { readGameSaveCheckpoint } from './persistence/game-save-checkpoint';
import {
  CanonicalChunkResidency,
  CanonicalChunkResidencyPressureError,
  maintainCanonicalChunks,
} from './chunk-residency';
import { createServerDerivedMeshSnapshot, prepareServerWorkerMeshInput } from './server-mesh-snapshots';
import { createLoadedGameplayVoxelReader, readCanonicalVoxel } from './server-voxel-access';
import { commitSingleWorldEdit } from './single-world-edit';
import { readLoadedCollisionBaseline } from './loaded-collision-baseline';
import {
  canonicalChunkNeighborhoodKeys,
  hasLoadedCanonicalChunk,
  retainCanonicalPreparation,
} from './canonical-chunk-observation';
import { assertCorePlatformPorts } from '../runtime/platform-ports';

export type { VoxelEdit } from './world-mutation';
export type * from './game-server-types';
import type {
  DerivedMeshSnapshot,
  GameServerOptions,
  ServerChunk,
  WorkerCanonicalResult,
  WorkerMeshPreparation,
  WorldCommitResult,
  WorldEditBatch,
} from './game-server-types';

export class GameServer extends GameServerGameplayFacade {
  readonly seed: number;
  readonly generatorVersion: number;
  private readonly chunks = new Map<string, ServerChunk>();
  private clock = 0;
  private accessSequence = 0;
  private readonly persistence?: ChunkPersistence & Partial<GameplayPersistence>;
  private revision = 0;
  private restoredSequence = 0;
  private appliedMutationCount = 0;
  private readonly fluidRuntime: FluidTransactionRuntime<WorldCommitResult>;
  private readonly fluidChunks: FluidChunkAccess;
  private readonly fluidChunkActivations = new FluidChunkActivationQueue();
  private readonly fluidWindow = new FluidActiveWindow();
  private readonly saves: GameSaveRuntime;
  private readonly canonicalResidency: CanonicalChunkResidency;
  private readonly stationResidency: StationWorldResidency;
  private readonly gameplayVoxelReader: (x: number, y: number, z: number) => number | undefined;

  constructor(readonly options: GameServerOptions) {
    super(options.persistence, assertCorePlatformPorts(options.platform), options.content, options);
    this.seed = normalizeSeed(options.seedText);
    this.generatorVersion = options.generatorVersion ?? GENERATOR_VERSION;
    if (this.generatorVersion !== 2 && this.generatorVersion !== 3 && this.generatorVersion !== GENERATOR_VERSION)
      throw new Error(`Unsupported generator version ${this.generatorVersion}.`);
    this.persistence = options.persistence;
    this.canonicalResidency = new CanonicalChunkResidency(options.canonicalResidency);
    this.stationResidency = new StationWorldResidency(this.gameplay.entities, this.canonicalResidency);
    this.gameplayVoxelReader = options.onUnknownChunk
      ? createLoadedGameplayVoxelReader(this.chunks, options.onUnknownChunk)
      : this.getVoxel;
    this.saves = new GameSaveRuntime({
      seedText: options.seedText,
      generatorVersion: this.generatorVersion,
      persistence: this.persistence,
      chunks: this.chunks,
      getWorldRevision: () => this.revision,
      createGameplaySnapshot: () => this.createGameplaySnapshot(),
      markGameplayPersisted: (revision) => this.markGameplayPersisted(revision),
      clone: options.platform.clone,
    });
    this.fluidChunks = new FluidChunkAccess(this.chunks, (cx, cy, cz) => this.getChunk(cx, cy, cz));
    this.fluidRuntime = new FluidTransactionRuntime({
      epoch: options.fluidEpoch ?? 1,
      readChunk: (key) =>
        FluidSidecars.readFluidChunk(key, (candidate) => this.fluidWindow.allowsKey(candidate), this.chunks),
      readCell: (position) =>
        FluidSidecars.readFluidCell(position, (x, y, z) => this.fluidWindow.allowsPosition(x, y, z), this.chunks),
      apply: (candidate) => this.applyFluidCandidate(candidate),
    });
  }

  get worldTime(): number {
    return this.clock;
  }

  override async restore(): Promise<void> {
    const checkpoint = readGameSaveCheckpoint(await this.persistence?.loadGameCheckpoint?.());
    await super.restore();
    await this.stationResidency.restore(this.persistence, (...at) => this.getChunk(...at));
    this.restoredSequence = checkpoint?.commitSequence ?? 0;
    this.revision = checkpoint?.worldRevision ?? 0;
  }

  validateStationCheckpoint(snapshot: FrozenGameSaveSnapshot): void {
    assertStationCheckpointIntegrity(snapshot, this.gameplay.content.stations?.codec);
  }

  get restoredCommitSequence(): number {
    return this.restoredSequence;
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

  get canonicalResidencyDiagnostics() {
    return this.canonicalResidency.diagnostics(this.chunks);
  }

  get canonicalResidencyNeedsMaintenance(): boolean {
    return this.chunks.size > this.canonicalResidency.limits.target;
  }

  maintainCanonicalResidency(): number {
    this.stationResidency.refresh();
    return maintainCanonicalChunks(this.canonicalResidency, this.chunks, ({ key, chunk, accessEpoch, revision }) =>
      this.saves.evictChunkIfCurrent(key, chunk as ServerChunk, accessEpoch, revision),
    );
  }

  setPhysicsActiveChunks(keys: readonly string[]): void {
    this.canonicalResidency.replacePins('physics', keys);
  }

  retainMeshChunk(cx: number, cy: number, cz: number): void {
    this.canonicalResidency.retainMesh(chunkKey(cx, cy, cz));
  }

  retainMeshPreparationNeighborhood(cx: number, cy: number, cz: number): () => void {
    return retainCanonicalPreparation(this.canonicalResidency, canonicalChunkNeighborhoodKeys(cx, cy, cz), () =>
      this.maintainCanonicalResidency(),
    );
  }

  hasLoadedCanonicalChunk(key: string): boolean {
    return hasLoadedCanonicalChunk(this.chunks, key);
  }

  retainCollisionBaseline(key: string): () => void {
    this.hasLoadedCanonicalChunk(key);
    return retainCanonicalPreparation(this.canonicalResidency, [key], () => this.maintainCanonicalResidency());
  }

  getChunk(cx: number, cy: number, cz: number): ServerChunk {
    const key = chunkKey(cx, cy, cz);
    const existing = this.chunks.get(key);
    if (existing) {
      existing.accessEpoch = ++this.accessSequence;
      return existing;
    }
    if (!this.prepareCanonicalAdmission(key)) throw new CanonicalChunkResidencyPressureError(key);
    const snapshot = this.persistence?.loadSnapshot(key);
    const restored = snapshot && this.isValidSnapshot(snapshot, key, cx, cy, cz);
    const chunk: ServerChunk = restored
      ? restoreServerChunk(snapshot, ++this.accessSequence)
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
    assertStationChunkIntegrity(chunk, this.gameplay.content.stations?.codec, this.gameplay.entities);
    this.chunks.set(key, chunk);
    this.persistence?.evictSnapshot?.(key);
    if (this.fluidWindow.allowsKey(key)) this.fluidChunkActivations.schedule(chunk);
    return chunk;
  }

  async ensureChunkNeighborhood(cx: number, cy: number, cz: number): Promise<ChunkPersistenceLoadDiagnostics | void> {
    const neighborhood = canonicalChunkNeighborhoodKeys(cx, cy, cz);
    const residentKeys = neighborhood.filter((key) => this.chunks.has(key));
    if (residentKeys.length === neighborhood.length) return;
    return await this.persistence?.ensureNeighborhood?.(cx, cy, cz, residentKeys);
  }

  async prepareCanonicalChunkForMutation(cx: number, cy: number, cz: number): Promise<boolean> {
    if (this.chunks.has(chunkKey(cx, cy, cz))) return true;
    if (this.persistence?.ensureSnapshot) await this.persistence.ensureSnapshot(cx, cy, cz);
    else await this.persistence?.ensureNeighborhood?.(cx, cy, cz);
    if (this.readAuthoritativeChunk(cx, cy, cz)) return true;
    if (this.options.onUnknownChunk) return false;
    this.getChunk(cx, cy, cz);
    return true;
  }

  releaseChunkNeighborhood(cx: number, cy: number, cz: number): void {
    this.canonicalResidency.releaseMesh(chunkKey(cx, cy, cz));
    this.persistence?.releaseNeighborhood?.(cx, cy, cz);
    this.maintainCanonicalResidency();
  }

  getVoxel = (x: number, y: number, z: number) => readCanonicalVoxel((...at) => this.getChunk(...at), x, y, z);

  peekLoadedVoxel = (x: number, y: number, z: number) => peekLoadedVoxel(this.chunks, x, y, z);

  readCollisionBaseline(key: string, minimumRevision: number) {
    return readLoadedCollisionBaseline(this.chunks, key, minimumRevision);
  }

  protected override readLoadedGameplayVoxel(x: number, y: number, z: number): number | undefined {
    return this.peekLoadedVoxel(x, y, z)?.voxel;
  }

  protected override readGameplayVoxel(x: number, y: number, z: number): number | undefined {
    return this.gameplayVoxelReader(x, y, z);
  }

  createDerivedMeshSnapshot(cx: number, cy: number, cz: number): DerivedMeshSnapshot {
    return createServerDerivedMeshSnapshot(this.meshSnapshotSource(), cx, cy, cz);
  }

  prepareWorkerMeshInput(cx: number, cy: number, cz: number): WorkerMeshPreparation {
    return prepareServerWorkerMeshInput(this.meshSnapshotSource(), cx, cy, cz);
  }

  acceptWorkerCanonical(result: WorkerCanonicalResult): boolean {
    if (
      result.generatorVersion !== this.generatorVersion ||
      result.key !== chunkKey(result.cx, result.cy, result.cz) ||
      result.canonical.length !== CHUNK_SIZE ** 3 ||
      !result.canonical.every((value) => value >= Voxel.Air && value <= MAX_VOXEL_ID)
    )
      return false;
    const current = this.chunks.get(result.key);
    if (current) {
      if (current.revision !== result.chunkRevision) return false;
      return current.voxels.every((value, index) => value === result.canonical[index]);
    }
    if (result.chunkRevision !== 0) return false;
    try {
      assertStationChunkIntegrity(
        { ...result, voxels: result.canonical },
        this.gameplay.content.stations?.codec,
        this.gameplay.entities,
      );
    } catch {
      return false;
    }
    if (!this.prepareCanonicalAdmission(result.key)) return false;
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
    this.persistence?.evictSnapshot?.(result.key);
    if (this.fluidWindow.allowsKey(result.key)) this.fluidChunkActivations.schedule(accepted);
    this.maintainCanonicalResidency();
    return true;
  }

  edit(x: number, y: number, z: number, value: number, actorId = 'system'): WorldCommitResult {
    [x, y, z].forEach(assertMutationCoordinate);
    assertVoxelValue(value);
    assertNoRawStationEdits(
      { actorId, edits: [{ x, y, z, value }] },
      this.gameplay.content.stations?.codec,
      this.gameplay.entities,
      this.getVoxel,
    );
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
        this.fluidRuntime.activate([x, y, z], this.fluidPriorityForActor(actorId));
      if (previousFluid?.source && value !== Voxel.Water) this.fluidRuntime.removeSource([x, y, z]);
    }
    return result;
  }

  requestFluidWork() {
    this.fluidChunkActivations.pumpRuntime(this.fluidRuntime, this.fluidChunks);
    const work = this.fluidRuntime.requestFluidWork();
    this.syncFluidLeasePins();
    return work;
  }

  commitFluidCandidate(candidate: FluidCandidate) {
    const result = this.fluidRuntime.commitFluidCandidate(candidate);
    const commit = result.accepted ? this.fluidRuntime.takeLastCommit() : undefined;
    this.syncFluidLeasePins();
    this.maintainCanonicalResidency();
    return { ...result, ...(commit ? { commit } : {}) };
  }

  abortFluidWork(workId: string, reason: string) {
    const aborted = this.fluidRuntime.abortLease(workId, reason);
    this.syncFluidLeasePins();
    this.maintainCanonicalResidency();
    return aborted;
  }

  get fluidDiagnostics() {
    return this.fluidRuntime.diagnostics;
  }

  setFluidActiveChunks(keys: readonly string[]): void {
    this.canonicalResidency.replacePins('streaming', keys);
    this.fluidChunkActivations.sync(keys, this.chunks);
    this.fluidWindow.update(keys);
    this.maintainCanonicalResidency();
  }

  getFluidCell(x: number, y: number, z: number): FluidCell | null {
    return this.getVoxel(x, y, z) === Voxel.Water
      ? (this.fluidChunks.cell(x, y, z, true) ?? { level: 8, source: true })
      : null;
  }

  editBatch(batch: WorldEditBatch): WorldCommitResult {
    assertNoRawStationEdits(batch, this.gameplay.content.stations?.codec, this.gameplay.entities, this.getVoxel);
    return commitServerWorldEdit(this.worldEditOptions(), batch);
  }

  prepareVoxelEdit(actorId: string, position: readonly [number, number, number], value: number) {
    return prepareServerWorldEdit(this.worldEditOptions(), { actorId, position, value });
  }

  private worldEditOptions() {
    return {
      chunks: this.chunks,
      getChunk: (cx: number, cy: number, cz: number) => this.getChunk(cx, cy, cz),
      getVoxel: this.getVoxel,
      getRevision: () => this.revision,
      setRevision: (revision: number) => {
        this.revision = revision;
      },
      addMutationCount: (count: number) => {
        this.appliedMutationCount += count;
      },
      commitSingleEdit: (actorId: string, x: number, y: number, z: number, value: number) =>
        this.commitSingleEdit(actorId, x, y, z, value),
      now: this.options.platform.now,
      fluidChunks: this.fluidChunks,
      fluidWindow: this.fluidWindow,
      fluidRuntime: this.fluidRuntime,
      priorityForBatch: (batch: WorldEditBatch) => this.fluidPriorityForBatch(batch),
    };
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
    return commitSingleWorldEdit({
      actorId,
      x,
      y,
      z,
      value,
      worldRevision: this.revision,
      getChunk: (cx, cy, cz) => this.getChunk(cx, cy, cz),
      setWorldRevision: (revision) => (this.revision = revision),
      addMutationCount: (count) => (this.appliedMutationCount += count),
    });
  }

  async flushDirtyChunks(): Promise<string[]> {
    return this.saves.flushDirtyChunks();
  }

  freezeSaveSnapshot(commitSequence: number): FrozenGameSaveSnapshot {
    return this.saves.freeze(commitSequence);
  }

  freezePortableSaveSnapshot(commitSequence: number): FrozenGameSaveSnapshot {
    return this.saves.freezePortable(commitSequence);
  }

  saveFrozen(
    snapshot: FrozenGameSaveSnapshot,
  ): Promise<{ savedChunks: string[]; gameplaySaved: boolean; commitSequence: number }> {
    return this.saves.saveFrozen(snapshot).then((result) => {
      this.maintainCanonicalResidency();
      return result;
    });
  }

  async save(commitSequence = 0) {
    return this.saveFrozen(this.freezeSaveSnapshot(commitSequence));
  }

  async evictChunk(cx: number, cy: number, cz: number): Promise<boolean> {
    this.stationResidency.refresh();
    if (this.canonicalResidency.isPinned(chunkKey(cx, cy, cz))) return false;
    return this.saves.evictChunk(cx, cy, cz);
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
    return this.initializeStarterEcologyWithReader(center, (x, y, z) => this.getVoxel(x, y, z));
  }

  initializeStarterEcologyFromLoadedWorld(center: [number, number, number]) {
    return this.initializeStarterEcologyWithReader(center, (x, y, z) => {
      const loaded = this.peekLoadedVoxel(x, y, z);
      if (!loaded) throw new Error(`Starter ecology requires loaded canonical voxel ${x},${y},${z}.`);
      return loaded.voxel;
    });
  }

  private initializeStarterEcologyWithReader(
    center: [number, number, number],
    getVoxel: (x: number, y: number, z: number) => number,
  ) {
    return initializeStarterEcologyBootstrap(this, center, getVoxel);
  }

  private isValidSnapshot(snapshot: ChunkSnapshot, key: string, cx: number, cy: number, cz: number): boolean {
    return isValidChunkSnapshot(snapshot, {
      seedText: this.options.seedText,
      generatorVersion: this.generatorVersion,
      key,
      cx,
      cy,
      cz,
    });
  }

  private readAuthoritativeChunk(
    cx: number,
    cy: number,
    cz: number,
    failOnResidencyPressure = false,
  ): ServerChunk | undefined {
    const key = chunkKey(cx, cy, cz);
    const existing = this.chunks.get(key);
    if (existing) {
      existing.accessEpoch = ++this.accessSequence;
      return existing;
    }
    if (!this.prepareCanonicalAdmission(key)) {
      if (failOnResidencyPressure && this.persistence?.preparedSnapshotStatus?.(key) !== 'missing')
        throw new CanonicalChunkResidencyPressureError(key);
      return undefined;
    }
    const snapshot = this.persistence?.loadSnapshot(key);
    if (!snapshot) return undefined;
    if (!this.isValidSnapshot(snapshot, key, cx, cy, cz))
      throw new Error(`Persisted canonical Chunk is invalid for ${key}.`);
    const restored = restoreServerChunk(snapshot, ++this.accessSequence);
    assertStationChunkIntegrity(restored, this.gameplay.content.stations?.codec, this.gameplay.entities);
    this.chunks.set(key, restored);
    this.persistence?.evictSnapshot?.(key);
    this.fluidChunkActivations.schedule(restored);
    return restored;
  }

  private syncFluidLeasePins(): void {
    this.canonicalResidency.replacePins('fluid', this.fluidRuntime.leasedChunkKeys);
  }

  private meshSnapshotSource() {
    return {
      seed: this.seed,
      generatorVersion: this.generatorVersion,
      getChunk: (cx: number, cy: number, cz: number) => this.getChunk(cx, cy, cz),
      readAuthoritativeChunk: (cx: number, cy: number, cz: number) => this.readAuthoritativeChunk(cx, cy, cz, true),
    };
  }

  private prepareCanonicalAdmission(key: string): boolean {
    return this.canonicalResidency.prepareAdmission(this.chunks, key, () => this.maintainCanonicalResidency());
  }
}
