import { makeChunk } from '../world/mesh';
import {
  createStoredChunkRecord,
  decodeStoredChunkRecord,
  storedChunkRecordBytes,
  type StoredChunkRecord,
  validateStoredFluid,
} from '../world/chunk-snapshot-codec';
import { GENERATOR_VERSION, LEGACY_GENERATOR_VERSION, Voxel, normalizeSeed } from '../world/voxel';
import { selectWorldGeneratorVersion, type WorldOpenMode } from '../client/world-version-policy';
import { persistFrozenGameSnapshot, type FrozenSaveTaskSnapshot } from './persistence-frozen-save';
import { validatePersistenceLoadBatch, type PersistenceLoadCoordinate } from './persistence-load-batch';
import { loadPersistenceBatch } from './persistence-load-many';

type WorkerConfig = { databaseName: string; worldId: string; seedText: string; generatorVersion: number };
type InitTask = { kind: 'init'; requestId: number; openMode: WorldOpenMode } & WorkerConfig;
type LoadTask = { kind: 'load'; requestId: number; cx: number; cy: number; cz: number };
type LoadBatchTask = { kind: 'load-batch'; requestId: number; coordinates: PersistenceLoadCoordinate[] };
type SaveTask = {
  kind: 'save';
  requestId: number;
  snapshots: Array<{
    key: string;
    cx: number;
    cy: number;
    cz: number;
    revision: number;
    voxels: ArrayBuffer;
    fluidVersion?: 1;
    fluid?: ArrayBuffer;
  }>;
};
type SaveMetadataTask = {
  kind: 'save-metadata';
  requestId: number;
  player: [number, number, number];
};
type SaveGameplayTask = { kind: 'save-gameplay'; requestId: number; snapshot: unknown };
type SaveFrozenTask = {
  kind: 'save-frozen';
  requestId: number;
  snapshot: FrozenSaveTaskSnapshot;
};
type StatsTask = { kind: 'stats'; requestId: number };
type SeedCorpusTask = { kind: 'seed-corpus'; requestId: number; chunkCount: number };
type MarkLegacyMigratedTask = { kind: 'mark-legacy-migrated'; requestId: number };
type LatestWorldTask = { kind: 'latest-world'; requestId: number; databaseName: string };
type Task =
  | InitTask
  | LoadTask
  | LoadBatchTask
  | SaveTask
  | SaveMetadataTask
  | SaveGameplayTask
  | SaveFrozenTask
  | StatsTask
  | SeedCorpusTask
  | MarkLegacyMigratedTask
  | LatestWorldTask;

type CorpusSummary = {
  storedChunkCount: number;
  rawBytes: number;
  legacyJsonBytes: number;
  recordBytes: number;
  payloadBytes: number;
  metadataBytes: number;
  codecs: Record<string, number>;
};

type WorldRecord = {
  worldId: string;
  seedText: string;
  generatorVersion: number;
  player: [number, number, number] | null;
  gameplaySnapshot?: unknown;
  corpusSummary?: CorpusSummary;
  legacyMigrated?: boolean;
  updatedAt: number;
  commitSequence?: number;
  worldRevision?: number;
};

type SuccessResponse = { requestId: number; ok: true; result: unknown };
type ErrorResponse = { requestId: number; ok: false; error: string };

let config: WorkerConfig | null = null;
let databasePromise: Promise<IDBDatabase> | null = null;
let taskQueue = Promise.resolve();

const requestResult = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });

const transactionDone = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
  });

const openDatabase = (databaseName: string) =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('worlds')) database.createObjectStore('worlds', { keyPath: 'worldId' });
      if (!database.objectStoreNames.contains('chunks'))
        database.createObjectStore('chunks', { keyPath: ['worldId', 'cx', 'cy', 'cz'] });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the Chunk persistence database.'));
  });

const database = () => {
  if (!config || !databasePromise) throw new Error('Persistence worker is not initialized.');
  return databasePromise;
};

const proceduralChunk = (cx: number, cy: number, cz: number) => {
  if (!config) throw new Error('Persistence worker is not initialized.');
  return makeChunk(normalizeSeed(config.seedText), cx, cy, cz, [], config.generatorVersion);
};

const normalizeRecord = (value: unknown): StoredChunkRecord => {
  if (!value || typeof value !== 'object') throw new Error('Stored Chunk record is corrupt.');
  const record = value as StoredChunkRecord;
  const storedPayload = (value as { payload?: unknown }).payload;
  const payload =
    storedPayload instanceof Uint8Array
      ? storedPayload
      : storedPayload instanceof ArrayBuffer
        ? new Uint8Array(storedPayload)
        : null;
  if (!payload) throw new Error('Stored Chunk payload is corrupt.');
  const storedFluid = (value as { fluid?: unknown }).fluid;
  const fluid =
    storedFluid instanceof Uint8Array
      ? storedFluid
      : storedFluid instanceof ArrayBuffer
        ? new Uint8Array(storedFluid)
        : undefined;
  return { ...record, payload, ...(fluid ? { fluid } : {}) };
};

const initialize = async (task: InitTask) => {
  databasePromise = openDatabase(task.databaseName);
  const opened = await databasePromise;
  const transaction = opened.transaction('worlds', 'readwrite');
  const done = transactionDone(transaction);
  const store = transaction.objectStore('worlds');
  const records = (await requestResult(store.getAll())) as WorldRecord[];
  const supportedRecords = records.filter(
    (record) => record.generatorVersion === GENERATOR_VERSION || record.generatorVersion === LEGACY_GENERATOR_VERSION,
  );
  const generatorVersion = selectWorldGeneratorVersion(
    supportedRecords,
    task.seedText,
    GENERATOR_VERSION,
    task.openMode,
  );
  if (generatorVersion !== GENERATOR_VERSION && generatorVersion !== LEGACY_GENERATOR_VERSION)
    throw new Error(`Stored world uses unsupported generator version ${generatorVersion}.`);
  const worldId = `seedlands:g${generatorVersion}:${task.seedText}`;
  config = { databaseName: task.databaseName, worldId, seedText: task.seedText, generatorVersion };
  const existing = records.find((record) => record.worldId === worldId);
  if (task.openMode === 'continue-legacy' && generatorVersion === GENERATOR_VERSION)
    throw new Error('这个 Seed 没有可继续的旧版 v2 世界。');
  if (existing && (existing.seedText !== task.seedText || existing.generatorVersion !== generatorVersion))
    throw new Error('Stored world metadata is incompatible with the requested seed or generator.');
  if (!existing)
    store.put({
      worldId,
      seedText: task.seedText,
      generatorVersion,
      player: null,
      updatedAt: Date.now(),
    } satisfies WorldRecord);
  await done;
  return {
    worldId,
    generatorVersion,
    player: existing?.player ?? null,
    gameplaySnapshot: existing?.gameplaySnapshot ?? null,
    checkpoint: existing
      ? { commitSequence: existing.commitSequence ?? 0, worldRevision: existing.worldRevision ?? 0 }
      : null,
    corpusSummary: existing?.corpusSummary ?? null,
    legacyMigrated: existing?.legacyMigrated ?? false,
  };
};

const decodeLoadResult = (task: PersistenceLoadCoordinate, value: unknown) => {
  if (!config) throw new Error('Persistence worker is not initialized.');
  if (value === undefined) return { status: 'missing' as const };
  const record = normalizeRecord(value);
  const startedAt = performance.now();
  const proceduralVoxels =
    record.codec === 'procedural-diff-v1' ? proceduralChunk(task.cx, task.cy, task.cz) : undefined;
  const voxels = decodeStoredChunkRecord(record, {
    worldId: config.worldId,
    seedText: config.seedText,
    cx: task.cx,
    cy: task.cy,
    cz: task.cz,
    revision: record.revision,
    formatVersion: 1,
    voxelSchemaVersion: 1,
    generatorVersion: config.generatorVersion,
    proceduralVoxels,
  });
  const fluid = validateStoredFluid(record);
  if (!voxels.every((voxel) => voxel >= Voxel.Air && voxel <= Voxel.Lantern))
    throw new Error('Stored Chunk contains a voxel outside the current schema.');
  return {
    status: 'found' as const,
    key: `${task.cx},${task.cy},${task.cz}`,
    cx: task.cx,
    cy: task.cy,
    cz: task.cz,
    revision: record.revision,
    codec: record.codec,
    recordBytes: storedChunkRecordBytes(record),
    decodeMs: performance.now() - startedAt,
    voxels: voxels.buffer,
    ...(fluid ? { fluidVersion: 1 as const, fluid: fluid.buffer } : {}),
  };
};

const loadMany = async (coordinates: readonly PersistenceLoadCoordinate[], queueWaitMs: number) => {
  if (!config) throw new Error('Persistence worker is not initialized.');
  return loadPersistenceBatch({
    coordinates,
    queueWaitMs,
    worldId: config.worldId,
    database,
    decode: decodeLoadResult,
  });
};

const load = async (task: LoadTask) => (await loadMany([task], 0)).entries[0];

const loadBatch = async (task: LoadBatchTask, queueWaitMs: number) =>
  loadMany(validatePersistenceLoadBatch(task.coordinates), queueWaitMs);

const save = async (task: SaveTask) => {
  if (!config) throw new Error('Persistence worker is not initialized.');
  const startedAt = performance.now();
  const records = task.snapshots.map((snapshot) => {
    const voxels = new Uint16Array(snapshot.voxels);
    return createStoredChunkRecord({
      worldId: config!.worldId,
      seedText: config!.seedText,
      cx: snapshot.cx,
      cy: snapshot.cy,
      cz: snapshot.cz,
      revision: snapshot.revision,
      formatVersion: 1,
      voxelSchemaVersion: 1,
      generatorVersion: config!.generatorVersion,
      voxels,
      proceduralVoxels: proceduralChunk(snapshot.cx, snapshot.cy, snapshot.cz),
      ...(snapshot.fluid ? { fluid: new Uint8Array(snapshot.fluid) } : {}),
    });
  });
  const encodeMs = performance.now() - startedAt;
  const opened = await database();
  const transaction = opened.transaction('chunks', 'readwrite', { durability: 'strict' });
  const done = transactionDone(transaction);
  const store = transaction.objectStore('chunks');
  for (const record of records) {
    const existingValue = await requestResult(store.get([record.worldId, record.cx, record.cy, record.cz]));
    if (existingValue !== undefined) {
      const existing = normalizeRecord(existingValue);
      if (existing.revision > record.revision) {
        transaction.abort();
        await done.catch(() => undefined);
        throw new Error(`Refusing to replace Chunk ${record.cx},${record.cy},${record.cz} with an older revision.`);
      }
      if (existing.revision === record.revision && existing.payloadChecksum !== record.payloadChecksum) {
        transaction.abort();
        await done.catch(() => undefined);
        throw new Error(`Chunk ${record.cx},${record.cy},${record.cz} revision conflicts with stored content.`);
      }
    }
    store.put(record);
  }
  await done;
  const codecs = records.reduce<Record<string, number>>((counts, record) => {
    counts[record.codec] = (counts[record.codec] ?? 0) + 1;
    return counts;
  }, {});
  return {
    saved: records.map((record) => ({ key: `${record.cx},${record.cy},${record.cz}`, revision: record.revision })),
    recordBytes: records.reduce((sum, record) => sum + storedChunkRecordBytes(record), 0),
    encodeMs,
    codecs,
  };
};

const saveMetadata = async (task: SaveMetadataTask) => {
  if (!config) throw new Error('Persistence worker is not initialized.');
  const opened = await database();
  const transaction = opened.transaction('worlds', 'readwrite');
  const done = transactionDone(transaction);
  const store = transaction.objectStore('worlds');
  const existing = (await requestResult(store.get(config.worldId))) as WorldRecord | undefined;
  store.put({
    ...existing,
    worldId: config.worldId,
    seedText: config.seedText,
    generatorVersion: config.generatorVersion,
    player: task.player,
    updatedAt: Date.now(),
  } satisfies WorldRecord);
  await done;
  return { saved: true };
};

const saveGameplay = async (task: SaveGameplayTask) => {
  if (!config) throw new Error('Persistence worker is not initialized.');
  const opened = await database();
  const transaction = opened.transaction('worlds', 'readwrite', { durability: 'strict' });
  const done = transactionDone(transaction);
  const store = transaction.objectStore('worlds');
  const existing = (await requestResult(store.get(config.worldId))) as WorldRecord | undefined;
  if (!existing) throw new Error('Stored world metadata is missing.');
  store.put({ ...existing, gameplaySnapshot: task.snapshot, updatedAt: Date.now() } satisfies WorldRecord);
  await done;
  return { saved: true };
};

const saveFrozen = async (task: SaveFrozenTask) => {
  if (!config) throw new Error('Persistence worker is not initialized.');
  const opened = await database();
  return persistFrozenGameSnapshot({
    database: opened,
    config,
    snapshot: task.snapshot,
    proceduralChunk,
    normalizeRecord,
  });
};

const markLegacyMigrated = async () => {
  if (!config) throw new Error('Persistence worker is not initialized.');
  const opened = await database();
  const transaction = opened.transaction('worlds', 'readwrite');
  const done = transactionDone(transaction);
  const store = transaction.objectStore('worlds');
  const existing = (await requestResult(store.get(config.worldId))) as WorldRecord | undefined;
  if (!existing) throw new Error('Stored world metadata is missing.');
  store.put({ ...existing, legacyMigrated: true, updatedAt: Date.now() } satisfies WorldRecord);
  await done;
  return { saved: true };
};

const latestWorld = async (task: LatestWorldTask) => {
  const opened = await openDatabase(task.databaseName);
  try {
    const transaction = opened.transaction('worlds', 'readonly');
    const done = transactionDone(transaction);
    const worlds = (await requestResult(transaction.objectStore('worlds').getAll())) as WorldRecord[];
    await done;
    const latest = worlds
      .filter(
        (world) => world.generatorVersion === GENERATOR_VERSION || world.generatorVersion === LEGACY_GENERATOR_VERSION,
      )
      .sort((left, right) => right.updatedAt - left.updatedAt)[0];
    return latest ? { seedText: latest.seedText } : null;
  } finally {
    opened.close();
  }
};

const stats = async () => {
  if (!config) throw new Error('Persistence worker is not initialized.');
  const opened = await database();
  const transaction = opened.transaction('chunks', 'readonly');
  const done = transactionDone(transaction);
  const store = transaction.objectStore('chunks');
  const count = await requestResult(
    store.count(
      IDBKeyRange.bound(
        [config.worldId, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
        [config.worldId, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
      ),
    ),
  );
  await done;
  return { storedChunkCount: count };
};

const worldChunkRange = (worldId: string) =>
  IDBKeyRange.bound(
    [worldId, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
    [worldId, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
  );

const corpusVoxels = (index: number, count: number) => {
  const procedural = proceduralChunk(index, 0, 0);
  const voxels = procedural.slice();
  if (count <= 8 || index < Math.ceil(count * 0.5)) {
    const edits = 1 + (index % 64);
    for (let edit = 0; edit < edits; edit += 1) voxels[(edit * 499 + index * 37) % voxels.length] = Voxel.Wood;
  } else if (index < Math.ceil(count * 0.875)) {
    for (let voxelIndex = 0; voxelIndex < voxels.length; voxelIndex += 1)
      voxels[voxelIndex] = (Math.floor(voxelIndex / 1_024) + index) % 8;
  } else {
    for (let voxelIndex = 0; voxelIndex < voxels.length; voxelIndex += 1)
      voxels[voxelIndex] = (Math.imul(voxelIndex + 1, index + 17) >>> 3) % 9;
  }
  return { procedural, voxels };
};

const seedCorpus = async (task: SeedCorpusTask): Promise<CorpusSummary> => {
  if (!config) throw new Error('Persistence worker is not initialized.');
  if (!Number.isInteger(task.chunkCount) || task.chunkCount < 1 || task.chunkCount > 1_024)
    throw new Error('Chunk corpus size must be between 1 and 1,024.');
  const opened = await database();
  const clearTransaction = opened.transaction('chunks', 'readwrite', { durability: 'strict' });
  const clearDone = transactionDone(clearTransaction);
  clearTransaction.objectStore('chunks').delete(worldChunkRange(config.worldId));
  await clearDone;

  const summary: CorpusSummary = {
    storedChunkCount: task.chunkCount,
    rawBytes: task.chunkCount * 32 ** 3 * Uint16Array.BYTES_PER_ELEMENT,
    legacyJsonBytes: 0,
    recordBytes: 0,
    payloadBytes: 0,
    metadataBytes: 0,
    codecs: {},
  };
  const encoder = new TextEncoder();
  const batchSize = 32;
  for (let start = 0; start < task.chunkCount; start += batchSize) {
    const records: StoredChunkRecord[] = [];
    for (let index = start; index < Math.min(start + batchSize, task.chunkCount); index += 1) {
      const { procedural, voxels } = corpusVoxels(index, task.chunkCount);
      const record = createStoredChunkRecord({
        worldId: config.worldId,
        seedText: config.seedText,
        cx: index,
        cy: 0,
        cz: 0,
        revision: 1,
        formatVersion: 1,
        voxelSchemaVersion: 1,
        generatorVersion: config.generatorVersion,
        voxels,
        proceduralVoxels: procedural,
      });
      const recordBytes = storedChunkRecordBytes(record);
      summary.recordBytes += recordBytes;
      summary.payloadBytes += record.payload.byteLength;
      summary.metadataBytes += recordBytes - record.payload.byteLength;
      summary.legacyJsonBytes += encoder.encode(JSON.stringify([...voxels])).byteLength;
      summary.codecs[record.codec] = (summary.codecs[record.codec] ?? 0) + 1;
      records.push(record);
    }
    const transaction = opened.transaction('chunks', 'readwrite', { durability: 'strict' });
    const done = transactionDone(transaction);
    const store = transaction.objectStore('chunks');
    records.forEach((record) => store.put(record));
    await done;
  }

  const metadataTransaction = opened.transaction('worlds', 'readwrite');
  const metadataDone = transactionDone(metadataTransaction);
  metadataTransaction.objectStore('worlds').put({
    worldId: config.worldId,
    seedText: config.seedText,
    generatorVersion: config.generatorVersion,
    player: null,
    corpusSummary: summary,
    updatedAt: Date.now(),
  } satisfies WorldRecord);
  await metadataDone;
  return summary;
};

const handle = async (task: Task, queueWaitMs = 0): Promise<unknown> => {
  if (task.kind === 'latest-world') return latestWorld(task);
  if (task.kind === 'init') return initialize(task);
  if (task.kind === 'load') return load(task);
  if (task.kind === 'load-batch') return loadBatch(task, queueWaitMs);
  if (task.kind === 'save') return save(task);
  if (task.kind === 'save-frozen') return saveFrozen(task);
  if (task.kind === 'save-metadata') return saveMetadata(task);
  if (task.kind === 'save-gameplay') return saveGameplay(task);
  if (task.kind === 'stats') return stats();
  if (task.kind === 'mark-legacy-migrated') return markLegacyMigrated();
  return seedCorpus(task);
};

self.onmessage = (event: MessageEvent<Task>) => {
  const enqueuedAt = performance.now();
  taskQueue = taskQueue.then(async () => {
    const task = event.data;
    try {
      const result = await handle(task, performance.now() - enqueuedAt);
      const response: SuccessResponse = { requestId: task.requestId, ok: true, result };
      const transfers: Transferable[] = [];
      const loaded = task.kind === 'load-batch' ? (result as Awaited<ReturnType<typeof loadMany>>).entries : [result];
      if (task.kind === 'load' || task.kind === 'load-batch')
        loaded.forEach((entry) => {
          if (!entry || typeof entry !== 'object' || !('voxels' in entry)) return;
          transfers.push((entry as { voxels: ArrayBuffer }).voxels);
          if ('fluid' in entry) transfers.push((entry as { fluid: ArrayBuffer }).fluid);
        });
      self.postMessage(response, transfers);
    } catch (error) {
      const response: ErrorResponse = {
        requestId: task.requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
      self.postMessage(response);
    }
  });
};
