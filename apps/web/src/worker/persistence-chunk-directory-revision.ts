import { persistenceTransactionDone, requestPersistenceResult } from './persistence-indexeddb';
import type { PersistenceWorldRecord } from './persistence-worker-protocol';

export function nextChunkDirectoryRevision(world: Readonly<{ chunkDirectoryRevision?: number }> | undefined): number {
  const stored = world?.chunkDirectoryRevision;
  const current = stored === undefined ? 0 : stored;
  if (!Number.isSafeInteger(current) || current < 0 || current >= Number.MAX_SAFE_INTEGER)
    throw new RangeError('Stored chunk directory revision is invalid or exhausted.');
  return current + 1;
}

/** Durable chunk writes and their invalidation version commit or abort together. */
export async function commitChunkDirectoryMutation(
  database: IDBDatabase,
  worldId: string,
  mutate: (chunks: IDBObjectStore) => void | Promise<void>,
): Promise<void> {
  const transaction = database.transaction(['worlds', 'chunks'], 'readwrite', { durability: 'strict' });
  const done = persistenceTransactionDone(transaction);
  try {
    const worlds = transaction.objectStore('worlds');
    const existing = (await requestPersistenceResult(worlds.get(worldId))) as PersistenceWorldRecord | undefined;
    if (!existing) throw new Error('Stored world metadata is missing.');
    const chunkDirectoryRevision = nextChunkDirectoryRevision(existing);
    await mutate(transaction.objectStore('chunks'));
    worlds.put({ ...existing, chunkDirectoryRevision } satisfies PersistenceWorldRecord);
    await done;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // IndexedDB may already have aborted the transaction.
    }
    await done.catch(() => undefined);
    throw error;
  }
}
