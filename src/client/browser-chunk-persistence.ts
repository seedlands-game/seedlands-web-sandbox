import type { ChunkPersistence, ChunkSnapshot } from '../server/persistence/chunk-persistence';
import { GENERATOR_VERSION, Voxel, chunkKey } from '../world/voxel';

export type SerializedChunkSnapshot = Omit<ChunkSnapshot, 'voxels'> & { voxels: number[] };
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
  player: [number, number, number] | null;
  corpusSummary: ChunkPersistenceCorpusSummary | null;
  legacyMigrated: boolean;
};
type LoadResult =
  | { status: 'missing' }
  | {
      status: 'found';
      key: string;
      cx: number;
      cy: number;
      cz: number;
      revision: number;
      codec: string;
      recordBytes: number;
      decodeMs: number;
      voxels: ArrayBuffer;
    };
type SaveResult = {
  saved: Array<{ key: string; revision: number }>;
  recordBytes: number;
  encodeMs: number;
  codecs: Record<string, number>;
};

export type BrowserPersistenceMetrics = {
  idbGetCount: number;
  idbPutCount: number;
  encodedChunkCount: number;
  decodedChunkCount: number;
  recordBytes: number;
  encodeMs: number;
  decodeSamplesMs: number[];
  codecs: Record<string, number>;
};

const cloneSnapshot = (snapshot: ChunkSnapshot): ChunkSnapshot => ({ ...snapshot, voxels: snapshot.voxels.slice() });

export class BrowserChunkPersistence implements ChunkPersistence {
  readonly worldId: string;
  private readonly snapshots = new Map<string, ChunkSnapshot>();
  private readonly missing = new Set<string>();
  private readonly loads = new Map<string, Promise<void>>();
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private readonly worker = new Worker(new URL('../worker/persistence-worker.ts', import.meta.url), { type: 'module' });
  private requestSequence = 0;
  private corpusSummaryValue: ChunkPersistenceCorpusSummary | null = null;
  private metricsValue: BrowserPersistenceMetrics = {
    idbGetCount: 0,
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
    options: { databaseName?: string; legacySnapshots?: readonly SerializedChunkSnapshot[] } = {},
  ): Promise<BrowserChunkPersistence> {
    const persistence = new BrowserChunkPersistence(seedText, null);
    const initialized = (await persistence.request({
      kind: 'init',
      databaseName: options.databaseName ?? 'seedlands-chunks-v1',
      worldId: persistence.worldId,
      seedText,
    })) as InitResult;
    persistence.playerValue = initialized.player;
    persistence.corpusSummaryValue = initialized.corpusSummary;
    if (options.legacySnapshots?.length && !initialized.legacyMigrated) {
      for (const snapshot of options.legacySnapshots)
        if (
          snapshot.seedText !== seedText ||
          snapshot.generatorVersion !== GENERATOR_VERSION ||
          snapshot.key !== chunkKey(snapshot.cx, snapshot.cy, snapshot.cz) ||
          !Number.isInteger(snapshot.revision) ||
          snapshot.revision < 0 ||
          snapshot.voxels.length !== 32 ** 3 ||
          !snapshot.voxels.every((voxel) => Number.isInteger(voxel) && voxel >= Voxel.Air && voxel <= Voxel.Water)
        )
          throw new Error(`Legacy Chunk snapshot is invalid for ${snapshot.key}.`);
      const snapshots = options.legacySnapshots.map((snapshot) => ({
        ...snapshot,
        voxels: Uint16Array.from(snapshot.voxels),
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

  get restoredPlayer(): [number, number, number] | null {
    return this.playerValue ? [...this.playerValue] : null;
  }

  private request(message: Record<string, unknown>, transfers: Transferable[] = []): Promise<unknown> {
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
    this.snapshots.delete(key);
    this.missing.delete(key);
  }

  async ensureSnapshot(cx: number, cy: number, cz: number): Promise<void> {
    const key = chunkKey(cx, cy, cz);
    if (this.snapshots.has(key) || this.missing.has(key)) return;
    const existing = this.loads.get(key);
    if (existing) return existing;
    const loading = this.loadSnapshotFromStore(cx, cy, cz).finally(() => this.loads.delete(key));
    this.loads.set(key, loading);
    return loading;
  }

  private async loadSnapshotFromStore(cx: number, cy: number, cz: number): Promise<void> {
    this.metricsValue.idbGetCount += 1;
    const result = (await this.request({ kind: 'load', cx, cy, cz })) as LoadResult;
    const key = chunkKey(cx, cy, cz);
    if (result.status === 'missing') {
      this.missing.add(key);
      return;
    }
    this.metricsValue.decodedChunkCount += 1;
    this.metricsValue.recordBytes += result.recordBytes;
    this.metricsValue.decodeSamplesMs.push(result.decodeMs);
    this.metricsValue.codecs[result.codec] = (this.metricsValue.codecs[result.codec] ?? 0) + 1;
    this.snapshots.set(key, {
      key,
      seedText: this.seedText,
      cx,
      cy,
      cz,
      generatorVersion: GENERATOR_VERSION,
      revision: result.revision,
      voxels: new Uint16Array(result.voxels),
    });
  }

  async ensureNeighborhood(cx: number, cy: number, cz: number): Promise<void> {
    const loads: Promise<void>[] = [];
    for (let y = cy - 1; y <= cy + 1; y += 1)
      for (let z = cz - 1; z <= cz + 1; z += 1)
        for (let x = cx - 1; x <= cx + 1; x += 1) loads.push(this.ensureSnapshot(x, y, z));
    await Promise.all(loads);
  }

  releaseNeighborhood(cx: number, cy: number, cz: number): void {
    for (let y = cy - 1; y <= cy + 1; y += 1)
      for (let z = cz - 1; z <= cz + 1; z += 1)
        for (let x = cx - 1; x <= cx + 1; x += 1) this.evictSnapshot(chunkKey(x, y, z));
  }

  async saveSnapshots(snapshots: readonly ChunkSnapshot[]): Promise<void> {
    if (!snapshots.length) return;
    const copies = snapshots.map((snapshot) => ({ ...snapshot, voxels: snapshot.voxels.slice() }));
    const transfers = copies.map((snapshot) => snapshot.voxels.buffer as Transferable);
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
    snapshots.forEach((snapshot) => this.missing.delete(snapshot.key));
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
    this.worker.terminate();
    const error = new Error('Chunk persistence was disposed.');
    this.pending.forEach((pending) => pending.reject(error));
    this.pending.clear();
  }
}

export function decodeBrowserWorldSave(raw: string | null): BrowserWorldSave | null {
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    if (
      typeof record.seed !== 'string' ||
      record.generatorVersion !== GENERATOR_VERSION ||
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
