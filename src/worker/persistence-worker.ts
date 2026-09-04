import { makeChunk } from '../world/mesh';
import {
  createStoredChunkRecord,
  decodeStoredChunkRecord,
  storedChunkRecordBytes,
  type StoredChunkRecord,
} from '../world/chunk-snapshot-codec';
import { GENERATOR_VERSION, Voxel, normalizeSeed } from '../world/voxel';

type WorkerConfig = { databaseName: string; worldId: string; seedText: string };
type InitTask = { kind: 'init'; requestId: number } & WorkerConfig;
type LoadTask = { kind: 'load'; requestId: number; cx: number; cy: number; cz: number };
type SaveTask = {
  kind: 'save';
  requestId: number;
  snapshots: Array<{ key: string; cx: number; cy: number; cz: number; revision: number; voxels: ArrayBuffer }>;
};
type SaveMetadataTask = {
  kind: 'save-metadata';
  requestId: number;
  player: [number, number, number];
};
type StatsTask = { kind: 'stats'; requestId: number };
type SeedCorpusTask = { kind: 'seed-corpus'; requestId: number; chunkCount: number };
type MarkLegacyMigratedTask = { kind: 'mark-legacy-migrated'; requestId: number };
type LatestWorldTask = { kind: 'latest-world'; requestId: number; databaseName: string };
type Task =
  | InitTask
  | LoadTask
  | SaveTask
  | SaveMetadataTask
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
  corpusSummary?: CorpusSummary;
  legacyMigrated?: boolean;
  updatedAt: number;
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
  return makeChunk(normalizeSeed(config.seedText), cx, cy, cz, []);
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
  return { ...record, payload };
};

const initialize = async (task: InitTask) => {
  config = { databaseName: task.databaseName, worldId: task.worldId, seedText: task.seedText };
  databasePromise = openDatabase(task.databaseName);
  const opened = await database();
  const transaction = opened.transaction('worlds', 'readwrite');
  const done = transactionDone(transaction);
  const store = transaction.objectStore('worlds');
  const existing = (await requestResult(store.get(task.worldId))) as WorldRecord | undefined;
  if (existing && (existing.seedText !== task.seedText || existing.generatorVersion !== GENERATOR_VERSION))
    throw new Error('Stored world metadata is incompatible with the requested seed or generator.');
  if (!existing)
    store.put({
      worldId: task.worldId,
      seedText: task.seedText,
      generatorVersion: GENERATOR_VERSION,
      player: null,
      updatedAt: Date.now(),
    } satisfies WorldRecord);
  await done;
  return {
    player: existing?.player ?? null,
    corpusSummary: existing?.corpusSummary ?? null,
    legacyMigrated: existing?.legacyMigrated ?? false,
  };
};

const load = async (task: LoadTask) => {
  if (!config) throw new Error('Persistence worker is not initialized.');
  const opened = await database();
  const transaction = opened.transaction('chunks', 'readonly');
  const done = transactionDone(transaction);
  const value = await requestResult(transaction.objectStore('chunks').get([config.worldId, task.cx, task.cy, task.cz]));
  await done;
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
    generatorVersion: GENERATOR_VERSION,
    proceduralVoxels,
  });
  if (!voxels.every((voxel) => voxel >= Voxel.Air && voxel <= Voxel.Water))
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
  };
};

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
      generatorVersion: GENERATOR_VERSION,
      voxels,
      proceduralVoxels: proceduralChunk(snapshot.cx, snapshot.cy, snapshot.cz),
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
    generatorVersion: GENERATOR_VERSION,
    player: task.player,
    updatedAt: Date.now(),
  } satisfies WorldRecord);
  await done;
  return { saved: true };
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
      .filter((world) => world.generatorVersion === GENERATOR_VERSION)
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
        generatorVersion: GENERATOR_VERSION,
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
    generatorVersion: GENERATOR_VERSION,
    player: null,
    corpusSummary: summary,
    updatedAt: Date.now(),
  } satisfies WorldRecord);
  await metadataDone;
  return summary;
};

const handle = async (task: Task): Promise<unknown> => {
  if (task.kind === 'latest-world') return latestWorld(task);
  if (task.kind === 'init') return initialize(task);
  if (task.kind === 'load') return load(task);
  if (task.kind === 'save') return save(task);
  if (task.kind === 'save-metadata') return saveMetadata(task);
  if (task.kind === 'stats') return stats();
  if (task.kind === 'mark-legacy-migrated') return markLegacyMigrated();
  return seedCorpus(task);
};

self.onmessage = (event: MessageEvent<Task>) => {
  taskQueue = taskQueue.then(async () => {
    const task = event.data;
    try {
      const result = await handle(task);
      const response: SuccessResponse = { requestId: task.requestId, ok: true, result };
      const transfers: Transferable[] = [];
      if (task.kind === 'load' && result && typeof result === 'object' && 'voxels' in result) {
        const buffer = (result as { voxels: ArrayBuffer }).voxels;
        transfers.push(buffer);
      }
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
