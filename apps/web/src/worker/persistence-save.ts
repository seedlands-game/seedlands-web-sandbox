import {
  createStoredChunkRecord,
  storedChunkRecordBytes,
  type StoredChunkRecord,
} from '@seedlands/stdlib/world/chunk-snapshot-codec';
import type { PersistenceSaveTask } from './persistence-worker-protocol';
import { browserCorePlatform } from '../platform/core-platform';

type Config = Readonly<{ worldId: string; seedText: string; generatorVersion: number }>;

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

export async function persistChunkSnapshots(options: {
  database: () => Promise<IDBDatabase>;
  config: Config;
  snapshots: PersistenceSaveTask['snapshots'];
  proceduralChunk: (cx: number, cy: number, cz: number) => Uint16Array;
  normalizeRecord: (value: unknown) => StoredChunkRecord;
  onEncodeCompleted?: (timing: Readonly<{ startedAtMs: number; completedAtMs: number }>) => void;
}) {
  const startedAt = performance.now();
  const records = options.snapshots.map((snapshot) => {
    const voxels = new Uint16Array(snapshot.voxels);
    return createStoredChunkRecord({
      worldId: options.config.worldId,
      seedText: options.config.seedText,
      cx: snapshot.cx,
      cy: snapshot.cy,
      cz: snapshot.cz,
      revision: snapshot.revision,
      formatVersion: 1,
      voxelSchemaVersion: 1,
      generatorVersion: options.config.generatorVersion,
      voxels,
      proceduralVoxels: options.proceduralChunk(snapshot.cx, snapshot.cy, snapshot.cz),
      ...(snapshot.fluid ? { fluid: new Uint8Array(snapshot.fluid) } : {}),
    });
  });
  const encodeCompletedAt = performance.now();
  const encodeMs = encodeCompletedAt - startedAt;
  options.onEncodeCompleted?.({ startedAtMs: startedAt, completedAtMs: encodeCompletedAt });
  const opened = await options.database();
  const transaction = opened.transaction('chunks', 'readwrite', { durability: 'strict' });
  const done = transactionDone(transaction);
  const store = transaction.objectStore('chunks');
  for (const record of records) {
    const existingValue = await requestResult(store.get([record.worldId, record.cx, record.cy, record.cz]));
    if (existingValue !== undefined) {
      const existing = options.normalizeRecord(existingValue);
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
    recordBytes: records.reduce((sum, record) => sum + storedChunkRecordBytes(record, browserCorePlatform.utf8), 0),
    encodeMs,
    codecs,
  };
}
