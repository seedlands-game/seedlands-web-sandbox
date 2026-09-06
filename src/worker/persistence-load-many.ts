import type { ChunkPersistenceLoadDiagnostics } from '../server/persistence/chunk-persistence';
import type { PersistenceLoadCoordinate } from './persistence-load-batch';

type LoadEntry = Readonly<{ status: 'missing' }> | Readonly<{ status: 'found'; codec: string }>;

export type PersistenceLoadBatchResult<Entry extends LoadEntry> = Readonly<{
  entries: readonly Entry[];
  diagnostics: ChunkPersistenceLoadDiagnostics;
}>;

const requestResult = <Value>(request: IDBRequest<Value>) =>
  new Promise<Value>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });

const transactionDone = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
  });

export async function loadPersistenceBatch<Entry extends LoadEntry>(options: {
  coordinates: readonly PersistenceLoadCoordinate[];
  queueWaitMs: number;
  worldId: string;
  database: () => Promise<IDBDatabase>;
  decode: (coordinate: PersistenceLoadCoordinate, value: unknown) => Entry;
}): Promise<PersistenceLoadBatchResult<Entry>> {
  const executionStartedAt = performance.now();
  const databaseStartedAt = performance.now();
  const opened = await options.database();
  const databaseMs = performance.now() - databaseStartedAt;
  const transactionStartedAt = performance.now();
  const transaction = opened.transaction('chunks', 'readonly');
  const done = transactionDone(transaction);
  const store = transaction.objectStore('chunks');
  let values: unknown[];
  try {
    values = await Promise.all(
      options.coordinates.map(({ cx, cy, cz }) => requestResult(store.get([options.worldId, cx, cy, cz]))),
    );
    await done;
  } catch (error) {
    await done.catch(() => undefined);
    throw error;
  }
  const transactionReadMs = performance.now() - transactionStartedAt;
  const decodeStartedAt = performance.now();
  const entries = options.coordinates.map((coordinate, index) => options.decode(coordinate, values[index]));
  const decodeMs = performance.now() - decodeStartedAt;
  const codecs: Record<string, number> = {};
  let foundCount = 0;
  entries.forEach((entry) => {
    if (entry.status !== 'found') return;
    foundCount += 1;
    codecs[entry.codec] = (codecs[entry.codec] ?? 0) + 1;
  });
  return {
    entries,
    diagnostics: {
      requestedKeyCount: options.coordinates.length,
      foundCount,
      missingCount: options.coordinates.length - foundCount,
      queueWaitMs: options.queueWaitMs,
      databaseMs,
      transactionReadMs,
      decodeMs,
      totalWorkerMs: options.queueWaitMs + performance.now() - executionStartedAt,
      codecs,
    },
  };
}
