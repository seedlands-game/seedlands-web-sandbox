import { restoreServerChunk } from './server-chunk-restore';
import { MediaWorldResidency } from './media-world-residency';
import { StationWorldResidency } from './station-world-residency';
import { assertStationChunkIntegrity } from './station-world-integrity';
import { GENERATOR_VERSION, SUPPORTED_GENERATOR_VERSIONS, biome, chunkKey, normalizeSeed } from '../world/voxel';
import type { ChunkPersistence, ChunkPersistenceLoadDiagnostics, ChunkSnapshot } from './persistence/chunk-persistence';
import type { GameplayPersistence } from './persistence/gameplay-persistence';
import { GameServerGameplayHost } from './game-server-gameplay-host';
import { createGameServerFluidRuntime, createNextGameServerFluidRuntime } from './game-server-fluid-runtime';
import { installGameServerGameplayApi, type GameServerGameplayApi } from './game-server-gameplay-api';
import { initializeStarterEcologyBootstrap } from './starter-ecology-bootstrap';
import type { FluidCell } from './fluid/fluid-cell';
import { FluidActiveWindow } from './fluid/fluid-active-window';
import { FluidChunkAccess } from './fluid/fluid-chunk-access';
import { FluidChunkActivationQueue } from './fluid/fluid-chunk-activation-queue';
import { isFluidVoxel } from './fluid/fluid-cell-state';
import { FluidTransactionRuntime } from './fluid/fluid-transaction-runtime';
import type { FluidCandidate } from './fluid/fluid-transaction';
import { peekLoadedVoxel } from './loaded-voxel-reader';
import { validateServerStationCheckpoint, validServerChunkSnapshot } from './game-server-restore';
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
import type { ServerWorldCommitHost } from './server-world-commit-host';
import {
  createGameServerWorldCommitApi,
  installGameServerWorldCommitApi,
  type GameServerWorldCommitApi,
} from './game-server-world-commit-adapter';
import { generateGameServerChunk, prepareGameServerRestoreChunks } from './game-server-restore-candidate';
import { acceptServerWorkerCanonical } from './game-server-canonical-admission';
import { readLoadedCollisionBaseline } from './loaded-collision-baseline';
import {
  canonicalChunkNeighborhoodKeys,
  hasLoadedCanonicalChunk,
  retainCanonicalPreparation,
} from './canonical-chunk-observation';
import { assertCorePlatformPorts } from '../runtime/platform-ports';
import type { KernelWorldgenProvider, KernelWorldgenProviderIdentity } from '@seedlands/kernel/spatial';
import { voxelGeometryForComposition } from './gameplay/modules/voxel-geometry-module';
import type { VoxelGeometryRegistryV1 } from '../world/voxel-geometry';

export type { VoxelEdit } from './world-mutation';
export type * from './game-server-types';
import type {
  DerivedMeshSnapshot,
  GameServerOptions,
  ServerChunk,
  WorkerCanonicalResult,
  WorkerMeshPreparation,
  WorldCommitResult,
} from './game-server-types';

class GameServerWorld {
  readonly seed: number;
  readonly generatorVersion: number;
  readonly worldgenProvider?: KernelWorldgenProviderIdentity;
  readonly voxelGeometry?: VoxelGeometryRegistryV1;
  private readonly worldgenRuntime?: KernelWorldgenProvider;
  private readonly chunks = new Map<string, ServerChunk>();
  private accessSequence = 0;
  private readonly persistence?: ChunkPersistence & Partial<GameplayPersistence>;
  private appliedMutationCount = 0;
  private fluidRuntime: FluidTransactionRuntime<WorldCommitResult>;
  private readonly fluidChunks: FluidChunkAccess;
  private readonly fluidChunkActivations = new FluidChunkActivationQueue();
  private readonly fluidWindow = new FluidActiveWindow();
  private readonly saves: GameSaveRuntime;
  private readonly canonicalResidency: CanonicalChunkResidency;
  private stationResidency: StationWorldResidency;
  private readonly mediaResidency: MediaWorldResidency;
  private readonly gameplayVoxelReader: (x: number, y: number, z: number) => number | undefined;
  private readonly gameplayHost: GameServerGameplayHost;
  private readonly worldCommits: ServerWorldCommitHost;
  private readonly worldCommitApi: GameServerWorldCommitApi;
  private readonly fluidRuntimeOptions = () => ({
    chunks: this.chunks,
    fluidWindow: this.fluidWindow,
    fluidChunks: this.fluidChunks,
    worldCommits: () => this.worldCommits,
  });

  constructor(readonly options: GameServerOptions) {
    this.seed = normalizeSeed(options.seedText);
    this.generatorVersion = options.generatorVersion ?? GENERATOR_VERSION;
    this.worldgenRuntime = options.worldgenProvider;
    this.worldgenProvider = options.worldgenProvider?.identity;
    this.voxelGeometry = voxelGeometryForComposition(options.composition);
    if (!SUPPORTED_GENERATOR_VERSIONS.includes(this.generatorVersion))
      throw new Error(`Unsupported generator version ${this.generatorVersion}.`);
    this.persistence = options.persistence;
    this.gameplayHost = new GameServerGameplayHost(
      options.persistence,
      assertCorePlatformPorts(options.platform),
      options.content,
      options,
      {
        seed: () => this.seed,
        biomeAt: (x, z) => biome(this.seed, x, z, this.generatorVersion),
        worldTime: () => this.kernelState.worldTime,
        getVoxel: (x, y, z) => this.getVoxel(x, y, z),
        editBatch: (batch) => this.worldCommitApi.editBatch(batch),
        prepareVoxelEdit: (actorId, position, voxel) => this.worldCommits.prepareVoxelEdit(actorId, position, voxel),
        prepareVoxelEdits: (actorId, edits) => this.worldCommitApi.prepareVoxelEdits(actorId, edits),
        setWorldTime: (hours) => this.setWorldTime(hours),
        readLoadedGameplayVoxel: (x, y, z) => this.readLoadedGameplayVoxel(x, y, z),
        readLoadedGameplayCell: (x, y, z) => this.readLoadedGameplayCell(x, y, z),
        readGameplayVoxel: (x, y, z) => this.readGameplayVoxel(x, y, z),
        readFluidCell: (x, y, z) => this.fluidChunks.cell(x, y, z, true),
        voxelGeometry: this.voxelGeometry,
      },
    );
    installGameServerGameplayApi(this, this.gameplayHost);
    this.canonicalResidency = new CanonicalChunkResidency(options.canonicalResidency);
    this.stationResidency = new StationWorldResidency(this.gameplay.entities, this.canonicalResidency);
    this.mediaResidency = new MediaWorldResidency(
      () => this.gameplay.media.checkpointPositions(),
      this.canonicalResidency,
    );
    this.gameplayVoxelReader = options.onUnknownChunk
      ? createLoadedGameplayVoxelReader(this.chunks, options.onUnknownChunk)
      : this.getVoxel;
    this.saves = new GameSaveRuntime({
      seedText: options.seedText,
      generatorVersion: this.generatorVersion,
      persistence: this.persistence,
      chunks: this.chunks,
      getCommitSequence: () => this.kernelState.commitSequence,
      getWorldRevision: () => this.kernelState.worldRevision,
      createGameplaySnapshot: () => this.gameplayHost.createGameplaySnapshot(),
      markGameplayPersisted: (revision) => this.gameplayHost.markGameplayPersisted(revision),
      clone: options.platform.clone,
    });
    this.fluidChunks = new FluidChunkAccess(this.chunks, (cx, cy, cz) => this.getChunk(cx, cy, cz));
    this.fluidRuntime = createGameServerFluidRuntime(options.fluidEpoch ?? 1, this.fluidRuntimeOptions());
    const worldCommit = createGameServerWorldCommitApi({
      chunks: this.chunks,
      getChunk: (cx, cy, cz) => this.getChunk(cx, cy, cz),
      getVoxel: this.getVoxel,
      getLoadedVoxel: (x, y, z) => this.readLoadedGameplayVoxel(x, y, z),
      kernelState: () => this.kernelState,
      mutationCount: { get: () => this.appliedMutationCount, set: (value) => (this.appliedMutationCount = value) },
      platform: options.platform,
      fluidChunks: this.fluidChunks,
      fluidWindow: this.fluidWindow,
      fluidRuntime: () => this.fluidRuntime,
      priorityForBatch: (batch) => this.gameplayHost.fluidPriorityForBatch(batch),
      entities: () => this.gameplay.entities,
      stationCodec: () => this.gameplay.content.stations?.codec,
      isVoxelRegistered: options.composition
        ? (value) => value === 0 || this.voxelSemantics.get(value) !== undefined
        : undefined,
    });
    this.worldCommits = worldCommit.commits;
    this.worldCommitApi = worldCommit;
    installGameServerWorldCommitApi(this, this.worldCommitApi);
  }

  // prettier-ignore
  get worldTime(): number { return this.kernelState.worldTime; }

  // prettier-ignore
  get executableWorldgenProvider(): KernelWorldgenProvider | undefined { return this.worldgenRuntime; }
  // prettier-ignore
  private get gameplay() { return this.gameplayHost.gameplay; }
  // prettier-ignore
  private get kernelState() { return this.gameplayHost.kernelState; }
  // prettier-ignore
  get authorityExecution() { return this.gameplay.authorityExecution; }
  // prettier-ignore
  get voxelSemantics() { return this.gameplay.content.voxelSemantics; }
  // prettier-ignore
  get hasGameplayComposition() { return this.gameplayHost.hasGameplayComposition; }

  async restore(): Promise<void> {
    const checkpoint = readGameSaveCheckpoint(await this.persistence?.loadGameCheckpoint?.());
    const prepared = await this.gameplayHost.prepareRestore();
    if (!prepared) {
      if (!checkpoint) return;
      const fluid = createNextGameServerFluidRuntime(this.fluidRuntime, this.fluidRuntimeOptions());
      this.kernelState.replaceEpoch();
      this.kernelState.restoreCommitFrontier(checkpoint.commitSequence, checkpoint.worldRevision);
      this.installRestoredFluidRuntime(fluid);
      return;
    }
    try {
      const fluid = createNextGameServerFluidRuntime(this.fluidRuntime, this.fluidRuntimeOptions());
      prepared.gameplay.kernelState.prepareReplacement(this.kernelState.epoch, {
        commitSequence: checkpoint?.commitSequence ?? 0,
        worldRevision: checkpoint?.worldRevision ?? 0,
      });
      const chunks = await prepareGameServerRestoreChunks({
        seedText: this.options.seedText,
        seed: this.seed,
        generatorVersion: this.generatorVersion,
        epoch: prepared.gameplay.kernelState.epoch,
        accessEpoch: this.accessSequence,
        provider: this.worldgenRuntime,
        persistence: this.persistence,
        currentChunks: this.chunks,
        currentEntities: this.gameplay.entities,
        candidateEntities: prepared.gameplay.entities,
        mediaPositions: prepared.gameplay.media.checkpointPositions(),
        stationCodec: prepared.gameplay.content.stations?.codec,
        ...(this.options.composition ? { voxelSemantics: prepared.gameplay.content.voxelSemantics } : {}),
      });
      prepared.gameplay.media.validateCheckpoint(([x, y, z]) => peekLoadedVoxel(chunks, x, y, z)?.voxel);
      this.chunks.clear();
      for (const [key, chunk] of chunks) this.chunks.set(key, chunk);
      this.accessSequence += chunks.size;
      this.stationResidency = new StationWorldResidency(prepared.gameplay.entities, this.canonicalResidency);
      this.stationResidency.refresh();
      this.gameplayHost.commitRestore(prepared);
      this.mediaResidency.refresh();
      this.installRestoredFluidRuntime(fluid);
    } catch (error) {
      try {
        this.gameplayHost.discardRestore(prepared);
      } catch {
        // The preparation error remains the authoritative restore failure.
      }
      throw error;
    }
  }

  validateStationCheckpoint(snapshot: FrozenGameSaveSnapshot): void {
    validateServerStationCheckpoint(snapshot, this.gameplay.content.stations?.codec);
  }

  get restoredCommitSequence(): number {
    return this.kernelState.commitSequence;
  }

  get commitSequence(): number {
    return this.kernelState.commitSequence;
  }

  get materializedChunkCount(): number {
    return [...this.chunks.values()].filter((chunk) => chunk.materialized).length;
  }

  get mutationCount(): number {
    return this.appliedMutationCount;
  }

  get worldRevision(): number {
    return this.kernelState.worldRevision;
  }

  get canonicalResidencyDiagnostics() {
    return this.canonicalResidency.diagnostics(this.chunks);
  }

  get canonicalResidencyNeedsMaintenance(): boolean {
    return this.chunks.size > this.canonicalResidency.limits.target;
  }

  maintainCanonicalResidency(): number {
    this.stationResidency.refresh();
    this.mediaResidency.refresh();
    return maintainCanonicalChunks(this.canonicalResidency, this.chunks, ({ key, chunk, accessEpoch, revision }) =>
      this.saves.evictChunkIfCurrent(key, chunk as ServerChunk, accessEpoch, revision),
    );
  }

  setPhysicsActiveChunks = (keys: readonly string[]): void => this.canonicalResidency.replacePins('physics', keys);

  retainMeshChunk = (cx: number, cy: number, cz: number): void =>
    this.canonicalResidency.retainMesh(chunkKey(cx, cy, cz));

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
    let chunk: ServerChunk;
    if (restored) chunk = restoreServerChunk(snapshot, ++this.accessSequence);
    else
      chunk = generateGameServerChunk({
        seed: this.seed,
        generatorVersion: this.generatorVersion,
        epoch: this.kernelState.epoch,
        accessEpoch: ++this.accessSequence,
        cx,
        cy,
        cz,
        provider: this.worldgenRuntime,
      });
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

  private readLoadedGameplayVoxel(x: number, y: number, z: number): number | undefined {
    return this.peekLoadedVoxel(x, y, z)?.voxel;
  }

  private readLoadedGameplayCell(x: number, y: number, z: number) {
    const loaded = this.peekLoadedVoxel(x, y, z);
    if (!loaded) return null;
    const fluid = this.fluidChunks.cell(x, y, z, false);
    return { voxel: loaded.voxel, fluid: fluid ? fluid.level | (fluid.source ? 0x80 : 0) : 0 };
  }

  private readGameplayVoxel(x: number, y: number, z: number): number | undefined {
    return this.gameplayVoxelReader(x, y, z);
  }

  createDerivedMeshSnapshot(cx: number, cy: number, cz: number): DerivedMeshSnapshot {
    return createServerDerivedMeshSnapshot(this.meshSnapshotSource(), cx, cy, cz);
  }

  prepareWorkerMeshInput(cx: number, cy: number, cz: number): WorkerMeshPreparation {
    return prepareServerWorkerMeshInput(this.meshSnapshotSource(), cx, cy, cz);
  }

  acceptWorkerCanonical(result: WorkerCanonicalResult): boolean {
    return acceptServerWorkerCanonical({
      result,
      generatorVersion: this.generatorVersion,
      provider: this.worldgenProvider,
      chunks: this.chunks,
      stationCodec: this.gameplay.content.stations?.codec,
      entities: this.gameplay.entities,
      ...(this.options.composition ? { voxelSemantics: this.voxelSemantics } : {}),
      prepareAdmission: (key) => this.prepareCanonicalAdmission(key),
      nextAccessEpoch: () => ++this.accessSequence,
      persistence: this.persistence,
      fluidAllows: (key) => this.fluidWindow.allowsKey(key),
      fluidActivations: this.fluidChunkActivations,
      maintainResidency: () => this.maintainCanonicalResidency(),
    });
  }

  edit(x: number, y: number, z: number, value: number, actorId = 'system'): WorldCommitResult {
    return this.worldCommitApi.editBatch({ actorId, edits: [{ x, y, z, value }] });
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
    return isFluidVoxel(this.getVoxel(x, y, z))
      ? (this.fluidChunks.cell(x, y, z, true) ?? { level: 8, source: true })
      : null;
  }

  async flushDirtyChunks(): Promise<string[]> {
    return this.saves.flushDirtyChunks();
  }

  freezeSaveSnapshot(): FrozenGameSaveSnapshot {
    return this.saves.freeze();
  }

  freezePortableSaveSnapshot(): FrozenGameSaveSnapshot {
    return this.saves.freezePortable();
  }

  saveFrozen(
    snapshot: FrozenGameSaveSnapshot,
  ): Promise<{ savedChunks: string[]; gameplaySaved: boolean; commitSequence: number }> {
    return this.saves.saveFrozen(snapshot).then((result) => {
      this.maintainCanonicalResidency();
      return result;
    });
  }

  async save() {
    return this.saveFrozen(this.freezeSaveSnapshot());
  }

  async evictChunk(cx: number, cy: number, cz: number): Promise<boolean> {
    this.stationResidency.refresh();
    this.mediaResidency.refresh();
    if (this.canonicalResidency.isPinned(chunkKey(cx, cy, cz))) return false;
    return this.saves.evictChunk(cx, cy, cz);
  }

  advanceClock(hours: number): number {
    return this.kernelState.setWorldTime(this.kernelState.epoch, this.kernelState.worldTime + hours);
  }

  setWorldTime(hours: number): number {
    return this.kernelState.setWorldTime(this.kernelState.epoch, hours);
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
    return initializeStarterEcologyBootstrap(this as unknown as GameServer, center, getVoxel);
  }

  private isValidSnapshot(snapshot: ChunkSnapshot, key: string, cx: number, cy: number, cz: number): boolean {
    return validServerChunkSnapshot(
      snapshot,
      {
        seedText: this.options.seedText,
        generatorVersion: this.generatorVersion,
        key,
        cx,
        cy,
        cz,
      },
      this.options.composition ? this.voxelSemantics : undefined,
    );
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

  private syncFluidLeasePins = (): void =>
    this.canonicalResidency.replacePins('fluid', this.fluidRuntime.leasedChunkKeys);

  private installRestoredFluidRuntime(runtime: FluidTransactionRuntime<WorldCommitResult>): void {
    this.fluidRuntime = runtime;
    this.fluidChunkActivations.restore(this.chunks);
    this.syncFluidLeasePins();
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

export type GameServer = GameServerWorld & GameServerGameplayApi & GameServerWorldCommitApi;
export const GameServer = GameServerWorld as unknown as new (options: GameServerOptions) => GameServer;
