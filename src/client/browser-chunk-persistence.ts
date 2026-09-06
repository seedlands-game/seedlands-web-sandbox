import type { ChunkPersistence, ChunkSnapshot } from '../server/persistence/chunk-persistence';
import type { GameplaySnapshot } from '../server/gameplay/gameplay-runtime';
import type { FrozenGameSaveSnapshot } from '../server/persistence/game-save-snapshot';
import { readGameSaveCheckpoint, type GameSaveCheckpoint } from '../server/persistence/game-save-checkpoint';
import { GENERATOR_VERSION, LEGACY_GENERATOR_VERSION, Voxel, chunkKey } from '../world/voxel';
import { prepareBrowserLoadResult, type PreparedBrowserLoadResult } from './browser-persistence-load';
import type { WorldOpenMode } from './world-version-policy';

export type SerializedChunkSnapshot = Omit<ChunkSnapshot, 'voxels' | 'fluid'> & { voxels: number[]; fluid?: number[] };
export type BrowserWorldSave = {
  seed: string;
  generatorVersion: number;
  player: [number, number, number];
  snapshots: SerializedChunkSnapshot[];
};

type WorkerSuccess = { requestId: number; ok: true; result: unknown };
type WorkerFailure = { requestId: number; ok: false; error: string };
type WorkerResponse = WorkerSuccess | WorkerFailure;
export type ChunkPersistenceCorpusSummary = {
  storedChunkCount: number;
  rawBytes: number;
  legacyJsonBytes: number;
  recordBytes: number;
  payloadBytes: number;
  metadataBytes: number;
  codecs: Record<string, number>;
};
type InitResult = {
  worldId: string;
  generatorVersion: number;
  player: [number, number, number] | null;
  gameplaySnapshot: unknown;
  checkpoint?: unknown;
  corpusSummary: ChunkPersistenceCorpusSummary | null;
  legacyMigrated: boolean;
};
type LoadCoordinate = Readonly<{ cx: number; cy: number; cz: number }>;
type LoadToken = Readonly<{ identity: symbol }>;
type SaveResult = {
  saved: Array<{ key: string; revision: number }>;
  recordBytes: number;
  encodeMs: number;
  codecs: Record<string, number>;
};

export type BrowserPersistenceMetrics = {
  idbGetCount: number;
  loadTransactionCount: number;
  idbPutCount: number;
  encodedChunkCount: number;
  decodedChunkCount: number;
  recordBytes: number;
  encodeMs: number;
  decodeSamplesMs: number[];
  codecs: Record<string, number>;
};

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
  private readonly loads = new Map<string, Promise<void>>();
  private readonly loadTokens = new Map<string, LoadToken>();
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
    snapshot.chunks.forEach((chunk) => this.invalidateSnapshot(chunk.key));
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
    const snapshot = this.snapshots.get(key);
    this.snapshots.delete(key);
    this.missing.delete(key);
    return snapshot ? cloneSnapshot(snapshot) : null;
  }

  evictSnapshot(key: string): void {
    this.invalidateSnapshot(key);
  }

  private invalidateSnapshot(key: string): void {
    this.snapshots.delete(key);
    this.missing.delete(key);
    this.loads.delete(key);
    this.loadTokens.delete(key);
  }

  async ensureSnapshot(cx: number, cy: number, cz: number): Promise<void> {
    const key = chunkKey(cx, cy, cz);
    if (this.snapshots.has(key) || this.missing.has(key)) return;
    const existing = this.loads.get(key);
    if (existing) return existing;
    const token: LoadToken = { identity: Symbol(key) };
    const loading = this.loadSnapshotFromStore(cx, cy, cz, token).finally(() => {
      if (this.loads.get(key) === loading) this.loads.delete(key);
      if (this.loadTokens.get(key) === token) this.loadTokens.delete(key);
    });
    this.loadTokens.set(key, token);
    this.loads.set(key, loading);
    return loading;
  }

  private async loadSnapshotFromStore(cx: number, cy: number, cz: number, token: LoadToken): Promise<void> {
    this.metricsValue.idbGetCount += 1;
    this.metricsValue.loadTransactionCount += 1;
    const result = await this.request({ kind: 'load', cx, cy, cz });
    const prepared = prepareBrowserLoadResult(this.seedText, this.generatorVersion, cx, cy, cz, result);
    if (this.loadTokens.get(prepared.key) === token) this.commitLoadResult(prepared);
  }

  private commitLoadResult(result: PreparedBrowserLoadResult): void {
    if (result.status === 'missing') {
      this.missing.add(result.key);
      return;
    }
    this.metricsValue.decodedChunkCount += 1;
    this.metricsValue.recordBytes += result.recordBytes;
    this.metricsValue.decodeSamplesMs.push(result.decodeMs);
    this.metricsValue.codecs[result.codec] = (this.metricsValue.codecs[result.codec] ?? 0) + 1;
    this.snapshots.set(result.key, result.snapshot);
  }

  private async loadSnapshotBatchFromStore(
    coordinates: readonly LoadCoordinate[],
    tokens: ReadonlyMap<string, LoadToken>,
  ): Promise<void> {
    this.metricsValue.idbGetCount += coordinates.length;
    this.metricsValue.loadTransactionCount += 1;
    const results = await this.request({ kind: 'load-batch', coordinates });
    if (!Array.isArray(results) || results.length !== coordinates.length)
      throw new Error('Persistence load batch result length does not match its request.');
    const prepared = results.map((result, index) => {
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
    prepared.forEach((result) => {
      if (this.loadTokens.get(result.key) === tokens.get(result.key)) this.commitLoadResult(result);
    });
  }

  async ensureNeighborhood(cx: number, cy: number, cz: number): Promise<void> {
    const loads = new Set<Promise<void>>();
    const coordinates: LoadCoordinate[] = [];
    for (let y = cy - 1; y <= cy + 1; y += 1)
      for (let z = cz - 1; z <= cz + 1; z += 1)
        for (let x = cx - 1; x <= cx + 1; x += 1) {
          const key = chunkKey(x, y, z);
          if (this.snapshots.has(key) || this.missing.has(key)) continue;
          const existing = this.loads.get(key);
          if (existing) loads.add(existing);
          else coordinates.push({ cx: x, cy: y, cz: z });
        }
    if (coordinates.length) {
      const tokens = new Map<string, LoadToken>();
      coordinates.forEach(({ cx: batchX, cy: batchY, cz: batchZ }) => {
        const key = chunkKey(batchX, batchY, batchZ);
        const token: LoadToken = { identity: Symbol(key) };
        tokens.set(key, token);
        this.loadTokens.set(key, token);
      });
      const batch = this.loadSnapshotBatchFromStore(coordinates, tokens).finally(() => {
        coordinates.forEach(({ cx: batchX, cy: batchY, cz: batchZ }) => {
          const key = chunkKey(batchX, batchY, batchZ);
          if (this.loads.get(key) === batch) this.loads.delete(key);
          if (this.loadTokens.get(key) === tokens.get(key)) this.loadTokens.delete(key);
        });
      });
      coordinates.forEach(({ cx: batchX, cy: batchY, cz: batchZ }) =>
        this.loads.set(chunkKey(batchX, batchY, batchZ), batch),
      );
      loads.add(batch);
    }
    await Promise.all(loads);
  }

  releaseNeighborhood(cx: number, cy: number, cz: number): void {
    for (let y = cy - 1; y <= cy + 1; y += 1)
      for (let z = cz - 1; z <= cz + 1; z += 1)
        for (let x = cx - 1; x <= cx + 1; x += 1) this.evictSnapshot(chunkKey(x, y, z));
  }

  async saveSnapshots(snapshots: readonly ChunkSnapshot[]): Promise<void> {
    if (!snapshots.length) return;
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
    snapshots.forEach((snapshot) => this.invalidateSnapshot(snapshot.key));
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
    this.loadTokens.clear();
  }
}

export function decodeBrowserWorldSave(raw: string | null): BrowserWorldSave | null {
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    if (
      typeof record.seed !== 'string' ||
      (record.generatorVersion !== GENERATOR_VERSION && record.generatorVersion !== LEGACY_GENERATOR_VERSION) ||
      !Array.isArray(record.player) ||
      record.player.length !== 3 ||
      !record.player.every(Number.isFinite) ||
      !Array.isArray(record.snapshots)
    )
      return null;
    return {
      seed: record.seed,
      generatorVersion: record.generatorVersion,
      player: [record.player[0] as number, record.player[1] as number, record.player[2] as number],
      snapshots: record.snapshots as SerializedChunkSnapshot[],
    };
  } catch {
    return null;
  }
}
