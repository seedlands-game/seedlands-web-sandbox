import type {
  ChunkPersistence,
  ChunkPersistenceLoadDiagnostics,
  ChunkSnapshot,
} from '../server/persistence/chunk-persistence';
import type { GameplaySnapshot } from '../server/gameplay/gameplay-runtime';
import type { FrozenGameSaveSnapshot } from '../server/persistence/game-save-snapshot';
import { readGameSaveCheckpoint, type GameSaveCheckpoint } from '../server/persistence/game-save-checkpoint';
import { GENERATOR_VERSION, Voxel, chunkKey } from '../world/voxel';
import { prepareBrowserLoadResult, type PreparedBrowserLoadResult } from './browser-persistence-load';
import {
  parseBrowserPersistenceLoadBatchResult,
  withBrowserPersistenceRoundTrip,
} from './browser-persistence-load-diagnostics';
import {
  BrowserPersistenceLoadRegistry,
  type BrowserPersistenceLoadToken,
  type BrowserPersistenceNeighborhoodLease,
} from './browser-persistence-load-registry';
import type { WorldOpenMode } from './world-version-policy';
import type { SerializedChunkSnapshot } from './browser-world-save';
import {
  prepareBrowserPersistenceNeighborhood,
  type BrowserPersistenceLoadCoordinate,
} from './browser-persistence-neighborhood';
import type { BrowserPersistenceMetrics, ChunkPersistenceCorpusSummary } from './browser-persistence-metrics';
import type {
  BrowserPersistenceInitResult as InitResult,
  BrowserPersistenceSaveResult as SaveResult,
  BrowserPersistenceWorkerResponse as WorkerResponse,
} from './browser-persistence-worker-contract';

export { decodeBrowserWorldSave } from './browser-world-save';
export type { BrowserWorldSave, SerializedChunkSnapshot } from './browser-world-save';
export type { BrowserPersistenceMetrics, ChunkPersistenceCorpusSummary } from './browser-persistence-metrics';

const cloneSnapshot = (snapshot: ChunkSnapshot): ChunkSnapshot => ({
  ...snapshot,
  voxels: snapshot.voxels.slice(),
  ...(snapshot.fluid ? { fluid: snapshot.fluid.slice() } : {}),
});

export class BrowserChunkPersistence implements ChunkPersistence {
  worldId: string;
  generatorVersion = GENERATOR_VERSION;
  private readonly snapshots = new Map<string, ChunkSnapshot>();
  private readonly missing = new Set<string>();
  private readonly cacheTokens = new Map<string, BrowserPersistenceLoadToken>();
  private readonly loads = new Map<string, Promise<void>>();
  private readonly loadRegistry = new BrowserPersistenceLoadRegistry();
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private readonly worker = new Worker(new URL('../worker/persistence-worker.ts', import.meta.url), { type: 'module' });
  private requestSequence = 0;
  private disposed = false;
  private corpusSummaryValue: ChunkPersistenceCorpusSummary | null = null;
  private metricsValue: BrowserPersistenceMetrics = {
    idbGetCount: 0,
    loadTransactionCount: 0,
    idbPutCount: 0,
    encodedChunkCount: 0,
    decodedChunkCount: 0,
    recordBytes: 0,
    encodeMs: 0,
    decodeSamplesMs: [],
    codecs: {},
  };

  private constructor(
    readonly seedText: string,
    player: [number, number, number] | null,
  ) {
    this.worldId = `seedlands:g${GENERATOR_VERSION}:${seedText}`;
    this.playerValue = player;
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      const pending = this.pending.get(response.requestId);
      if (!pending) return;
      this.pending.delete(response.requestId);
      if (response.ok) pending.resolve(response.result);
      else pending.reject(new Error(response.error));
    };
    this.worker.onerror = (event) => {
      const error = new Error(event.message || 'Chunk persistence worker failed.');
      this.pending.forEach((pendingRequest) => pendingRequest.reject(error));
      this.pending.clear();
    };
  }

  static async open(
    seedText: string,
    options: {
      databaseName?: string;
      legacySnapshots?: readonly SerializedChunkSnapshot[];
      openMode?: WorldOpenMode;
    } = {},
  ): Promise<BrowserChunkPersistence> {
    const persistence = new BrowserChunkPersistence(seedText, null);
    const initialized = (await persistence.request({
      kind: 'init',
      databaseName: options.databaseName ?? 'seedlands-chunks-v1',
      worldId: persistence.worldId,
      seedText,
      openMode: options.openMode ?? 'continue',
    })) as InitResult;
    persistence.worldId = initialized.worldId;
    persistence.generatorVersion = initialized.generatorVersion;
    persistence.playerValue = initialized.player;
    persistence.gameplaySnapshotValue = initialized.gameplaySnapshot;
    persistence.checkpointValue = readGameSaveCheckpoint(initialized.checkpoint);
    persistence.corpusSummaryValue = initialized.corpusSummary;
    if (options.legacySnapshots?.length && !initialized.legacyMigrated) {
      for (const snapshot of options.legacySnapshots)
        if (
          snapshot.seedText !== seedText ||
          snapshot.generatorVersion !== persistence.generatorVersion ||
          snapshot.key !== chunkKey(snapshot.cx, snapshot.cy, snapshot.cz) ||
          !Number.isInteger(snapshot.revision) ||
          snapshot.revision < 0 ||
          snapshot.voxels.length !== 32 ** 3 ||
          !snapshot.voxels.every((voxel) => Number.isInteger(voxel) && voxel >= Voxel.Air && voxel <= Voxel.Lantern)
        )
          throw new Error(`Legacy Chunk snapshot is invalid for ${snapshot.key}.`);
      const snapshots: ChunkSnapshot[] = options.legacySnapshots.map(({ voxels, fluid, ...snapshot }) => ({
        ...snapshot,
        voxels: Uint16Array.from(voxels),
        ...(fluid ? { fluid: Uint8Array.from(fluid) } : {}),
      }));
      await persistence.saveSnapshots(snapshots);
      for (const snapshot of snapshots) {
        persistence.evictSnapshot(snapshot.key);
        await persistence.ensureSnapshot(snapshot.cx, snapshot.cy, snapshot.cz);
        const verified = persistence.loadSnapshot(snapshot.key);
        if (
          !verified ||
          verified.revision !== snapshot.revision ||
          !verified.voxels.every((voxel, index) => voxel === snapshot.voxels[index])
        )
          throw new Error(`Legacy Chunk migration readback failed for ${snapshot.key}.`);
      }
      await persistence.request({ kind: 'mark-legacy-migrated' });
    }
    return persistence;
  }

  static async latestWorld(databaseName = 'seedlands-chunks-v1'): Promise<{ seedText: string } | null> {
    const persistence = new BrowserChunkPersistence('', null);
    try {
      return (await persistence.request({ kind: 'latest-world', databaseName })) as { seedText: string } | null;
    } finally {
      persistence.dispose();
    }
  }

  private playerValue: [number, number, number] | null = null;
  private gameplaySnapshotValue: unknown = null;
  private checkpointValue: GameSaveCheckpoint | null = null;

  get restoredPlayer(): [number, number, number] | null {
    return this.playerValue ? [...this.playerValue] : null;
  }

  loadGameplaySnapshot(): unknown {
    return structuredClone(this.gameplaySnapshotValue);
  }

  loadGameCheckpoint(): GameSaveCheckpoint | null {
    return this.checkpointValue ? { ...this.checkpointValue } : null;
  }

  async saveGameplaySnapshot(snapshot: GameplaySnapshot): Promise<void> {
    const copy = structuredClone(snapshot);
    await this.request({ kind: 'save-gameplay', snapshot: copy });
    this.gameplaySnapshotValue = copy;
  }

  async saveFrozenSnapshot(snapshot: FrozenGameSaveSnapshot): Promise<void> {
    const saveFence = this.loadRegistry.captureSaveFence();
    const copy = structuredClone(snapshot);
    const transfers = copy.chunks.flatMap((chunk) => [
      chunk.voxels.buffer as Transferable,
      ...(chunk.fluid ? [chunk.fluid.buffer as Transferable] : []),
    ]);
    const result = (await this.request(
      {
        kind: 'save-frozen',
        snapshot: {
          ...copy,
          chunks: copy.chunks.map((chunk) => ({
            ...chunk,
            voxels: chunk.voxels.buffer,
            ...(chunk.fluid ? { fluid: chunk.fluid.buffer } : {}),
          })),
        },
      },
      transfers,
    )) as SaveResult;
    this.metricsValue.idbPutCount += result.saved.length + 1;
    this.metricsValue.encodedChunkCount += result.saved.length;
    this.metricsValue.recordBytes += result.recordBytes;
    this.metricsValue.encodeMs += result.encodeMs;
    Object.entries(result.codecs).forEach(([codec, count]) => {
      this.metricsValue.codecs[codec] = (this.metricsValue.codecs[codec] ?? 0) + count;
    });
    this.applySaveFence(
      snapshot.chunks.map((chunk) => chunk.key),
      saveFence,
    );
    this.gameplaySnapshotValue = structuredClone(snapshot.gameplay);
    this.checkpointValue = readGameSaveCheckpoint(snapshot);
  }

  loadLegacyPlayerPosition(): [number, number, number] | null {
    return this.restoredPlayer;
  }

  private request(message: Record<string, unknown>, transfers: Transferable[] = []): Promise<unknown> {
    if (this.disposed) return Promise.reject(new Error('Chunk persistence was disposed.'));
    const requestId = ++this.requestSequence;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.worker.postMessage({ ...message, requestId }, transfers);
    });
  }

  loadSnapshot(key: string): ChunkSnapshot | null {
    const hasResult = this.snapshots.has(key) || this.missing.has(key);
    const snapshot = this.snapshots.get(key);
    this.snapshots.delete(key);
    this.missing.delete(key);
    this.cacheTokens.delete(key);
    if (hasResult) this.loadRegistry.consumeExact(key);
    else if (this.loadRegistry.consumeInvalidatedExact(key))
      throw new Error(`Persistence load result was superseded by a save for ${key}.`);
    return snapshot ? cloneSnapshot(snapshot) : null;
  }

  preparedSnapshotStatus(key: string) {
    if (this.snapshots.has(key)) return 'found' as const;
    if (this.missing.has(key)) return 'missing' as const;
    return 'unknown' as const;
  }

  evictSnapshot(key: string): void {
    this.clearCachedSnapshot(key);
  }

  private clearCachedSnapshot(key: string): void {
    this.snapshots.delete(key);
    this.missing.delete(key);
    this.cacheTokens.delete(key);
  }

  async ensureSnapshot(cx: number, cy: number, cz: number): Promise<void> {
    const key = chunkKey(cx, cy, cz);
    this.loadRegistry.claimExact(key);
    try {
      if (this.snapshots.has(key) || this.missing.has(key)) return;
      const existing = this.loads.get(key);
      if (existing) return await existing;
      const token = this.loadRegistry.beginLoad(key);
      const loading = this.loadSnapshotFromStore(cx, cy, cz, token).finally(() => {
        if (this.loads.get(key) === loading) this.loads.delete(key);
        this.loadRegistry.finishLoad(key, token);
      });
      this.loads.set(key, loading);
      await loading;
    } catch (error) {
      this.loadRegistry.failExact(key);
      throw error;
    }
  }

  private async loadSnapshotFromStore(
    cx: number,
    cy: number,
    cz: number,
    token: BrowserPersistenceLoadToken,
  ): Promise<void> {
    this.metricsValue.idbGetCount += 1;
    this.metricsValue.loadTransactionCount += 1;
    const result = await this.request({ kind: 'load', cx, cy, cz });
    const prepared = prepareBrowserLoadResult(this.seedText, this.generatorVersion, cx, cy, cz, result);
    if (!this.loadRegistry.shouldPublish(prepared.key, token))
      throw new Error(`Persistence load was canceled for ${prepared.key}.`);
    this.commitLoadResult(prepared, token);
  }

  private commitLoadResult(result: PreparedBrowserLoadResult, token: BrowserPersistenceLoadToken): void {
    if (result.status === 'missing') {
      this.missing.add(result.key);
      this.cacheTokens.set(result.key, token);
      return;
    }
    this.metricsValue.decodedChunkCount += 1;
    this.metricsValue.recordBytes += result.recordBytes;
    this.metricsValue.decodeSamplesMs.push(result.decodeMs);
    this.metricsValue.codecs[result.codec] = (this.metricsValue.codecs[result.codec] ?? 0) + 1;
    this.snapshots.set(result.key, result.snapshot);
    this.cacheTokens.set(result.key, token);
  }

  private async loadSnapshotBatchFromStore(
    coordinates: readonly BrowserPersistenceLoadCoordinate[],
    tokens: ReadonlyMap<string, BrowserPersistenceLoadToken>,
  ): Promise<Readonly<{ published: ReadonlySet<string>; diagnostics: ChunkPersistenceLoadDiagnostics }>> {
    this.metricsValue.idbGetCount += coordinates.length;
    this.metricsValue.loadTransactionCount += 1;
    const requestSentAtEpochMs = performance.timeOrigin + performance.now();
    const response = parseBrowserPersistenceLoadBatchResult(
      await this.request({ kind: 'load-batch', coordinates, requestSentAtEpochMs }),
      coordinates.length,
    );
    const responseReceivedAtEpochMs = performance.timeOrigin + performance.now();
    const prepared = response.entries.map((result, index) => {
      const coordinate = coordinates[index]!;
      return prepareBrowserLoadResult(
        this.seedText,
        this.generatorVersion,
        coordinate.cx,
        coordinate.cy,
        coordinate.cz,
        result,
      );
    });
    const published = new Set<string>();
    prepared.forEach((result) => {
      const token = tokens.get(result.key)!;
      if (!this.loadRegistry.shouldPublish(result.key, token)) return;
      this.commitLoadResult(result, token);
      published.add(result.key);
    });
    return {
      published,
      diagnostics: withBrowserPersistenceRoundTrip(
        response.diagnostics,
        requestSentAtEpochMs,
        response.responsePostedAtEpochMs,
        responseReceivedAtEpochMs,
      ),
    };
  }

  async ensureNeighborhood(
    cx: number,
    cy: number,
    cz: number,
    residentKeys: readonly string[] = [],
  ): Promise<ChunkPersistenceLoadDiagnostics | void> {
    const centerKey = chunkKey(cx, cy, cz);
    const { coordinates: neighborhood, residentKeys: resident } = prepareBrowserPersistenceNeighborhood(
      cx,
      cy,
      cz,
      residentKeys,
    );
    const lease = this.loadRegistry.beginNeighborhood(
      centerKey,
      neighborhood.map(({ cx: x, cy: y, cz: z }) => chunkKey(x, y, z)),
    );
    const loads = new Set<Promise<void>>();
    const coordinates: BrowserPersistenceLoadCoordinate[] = [];
    let sharedDependencyCount = 0;
    let batchResult:
      Promise<Readonly<{ published: ReadonlySet<string>; diagnostics: ChunkPersistenceLoadDiagnostics }>> | undefined;
    neighborhood.forEach((coordinate) => {
      const key = chunkKey(coordinate.cx, coordinate.cy, coordinate.cz);
      if (resident.has(key) || this.snapshots.has(key) || this.missing.has(key)) return;
      const existing = this.loads.get(key);
      if (existing) {
        loads.add(existing);
        sharedDependencyCount += 1;
      } else coordinates.push(coordinate);
    });
    if (coordinates.length) {
      const tokens = new Map<string, BrowserPersistenceLoadToken>();
      coordinates.forEach(({ cx: batchX, cy: batchY, cz: batchZ }) => {
        const key = chunkKey(batchX, batchY, batchZ);
        tokens.set(key, this.loadRegistry.beginLoad(key));
      });
      const batch = this.loadSnapshotBatchFromStore(coordinates, tokens);
      batchResult = batch;
      coordinates.forEach(({ cx: batchX, cy: batchY, cz: batchZ }) => {
        const key = chunkKey(batchX, batchY, batchZ);
        const token = tokens.get(key)!;
        const keyedLoad = batch
          .then(({ published }) => {
            if (!published.has(key)) throw new Error(`Persistence neighborhood load was canceled for ${key}.`);
          })
          .finally(() => {
            if (this.loads.get(key) === keyedLoad) this.loads.delete(key);
            this.loadRegistry.finishLoad(key, token);
          });
        this.loads.set(key, keyedLoad);
        loads.add(keyedLoad);
      });
    }
    try {
      await Promise.all(loads);
      if (!this.loadRegistry.isNeighborhoodCurrent(lease))
        throw new Error(`Persistence neighborhood load was canceled for ${centerKey}.`);
      const completedBatch = await batchResult;
      return completedBatch ? { ...completedBatch.diagnostics, sharedDependencyCount } : undefined;
    } catch (error) {
      this.releaseNeighborhoodLease(centerKey, lease);
      throw error;
    }
  }

  releaseNeighborhood(cx: number, cy: number, cz: number): void {
    this.releaseNeighborhoodLease(chunkKey(cx, cy, cz));
  }

  private releaseNeighborhoodLease(centerKey: string, lease?: BrowserPersistenceNeighborhoodLease): void {
    this.loadRegistry.releaseNeighborhood(centerKey, lease).forEach((key) => {
      this.clearCachedSnapshot(key);
      this.loads.delete(key);
    });
  }

  async saveSnapshots(snapshots: readonly ChunkSnapshot[]): Promise<void> {
    if (!snapshots.length) return;
    const saveFence = this.loadRegistry.captureSaveFence();
    const copies = snapshots.map((snapshot) => ({
      ...snapshot,
      voxels: snapshot.voxels.slice(),
      ...(snapshot.fluid ? { fluid: snapshot.fluid.slice() } : {}),
    }));
    const transfers = copies.flatMap((snapshot) => [
      snapshot.voxels.buffer as Transferable,
      ...(snapshot.fluid ? [snapshot.fluid.buffer as Transferable] : []),
    ]);
    const result = (await this.request(
      {
        kind: 'save',
        snapshots: copies.map((snapshot) => ({
          key: snapshot.key,
          cx: snapshot.cx,
          cy: snapshot.cy,
          cz: snapshot.cz,
          revision: snapshot.revision,
          voxels: snapshot.voxels.buffer,
          ...(snapshot.fluid ? { fluidVersion: 1, fluid: snapshot.fluid.buffer } : {}),
        })),
      },
      transfers,
    )) as SaveResult;
    this.metricsValue.idbPutCount += result.saved.length;
    this.metricsValue.encodedChunkCount += result.saved.length;
    this.metricsValue.recordBytes += result.recordBytes;
    this.metricsValue.encodeMs += result.encodeMs;
    Object.entries(result.codecs).forEach(([codec, count]) => {
      this.metricsValue.codecs[codec] = (this.metricsValue.codecs[codec] ?? 0) + count;
    });
    this.applySaveFence(
      snapshots.map((snapshot) => snapshot.key),
      saveFence,
    );
  }

  private applySaveFence(keys: readonly string[], saveFence: number): void {
    keys.forEach((key) => {
      const token = this.cacheTokens.get(key);
      if (token && token.generation <= saveFence) {
        this.clearCachedSnapshot(key);
        this.loadRegistry.invalidateExact(key);
      }
    });
    this.loadRegistry.applySaveFence(keys, saveFence).forEach((key) => this.loads.delete(key));
  }

  async saveMetadata(player: [number, number, number]): Promise<void> {
    await this.request({ kind: 'save-metadata', player });
  }

  async stats(): Promise<{ storedChunkCount: number }> {
    return (await this.request({ kind: 'stats' })) as { storedChunkCount: number };
  }

  async seedCorpus(chunkCount: number): Promise<ChunkPersistenceCorpusSummary> {
    const summary = (await this.request({ kind: 'seed-corpus', chunkCount })) as ChunkPersistenceCorpusSummary;
    this.corpusSummaryValue = summary;
    return summary;
  }

  get corpusSummary(): ChunkPersistenceCorpusSummary | null {
    return this.corpusSummaryValue
      ? { ...this.corpusSummaryValue, codecs: { ...this.corpusSummaryValue.codecs } }
      : null;
  }

  get residentSnapshotCount(): number {
    return this.snapshots.size;
  }

  metrics(): BrowserPersistenceMetrics {
    return {
      ...this.metricsValue,
      decodeSamplesMs: [...this.metricsValue.decodeSamplesMs],
      codecs: { ...this.metricsValue.codecs },
    };
  }

  resetMetrics(): void {
    this.metricsValue = {
      idbGetCount: 0,
      loadTransactionCount: 0,
      idbPutCount: 0,
      encodedChunkCount: 0,
      decodedChunkCount: 0,
      recordBytes: 0,
      encodeMs: 0,
      decodeSamplesMs: [],
      codecs: {},
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.terminate();
    const error = new Error('Chunk persistence was disposed.');
    this.pending.forEach((pending) => pending.reject(error));
    this.pending.clear();
    this.loads.clear();
    this.snapshots.clear();
    this.missing.clear();
    this.cacheTokens.clear();
    this.loadRegistry.dispose();
  }
}
