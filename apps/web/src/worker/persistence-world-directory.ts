import { isSupportedGeneratorVersion } from '@seedlands/stdlib/world/voxel';
import type { PersistenceWorldRecord } from './persistence-worker-protocol';
import { openPersistenceDatabase, persistenceTransactionDone, requestPersistenceResult } from './persistence-indexeddb';

export const worldChunkRange = (worldId: string) =>
  IDBKeyRange.bound(
    [worldId, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
    [worldId, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
  );

export async function listStoredWorlds(databaseName: string) {
  const opened = await openPersistenceDatabase(databaseName);
  try {
    const transaction = opened.transaction('worlds', 'readonly');
    const done = persistenceTransactionDone(transaction);
    const worlds = (await requestPersistenceResult(
      transaction.objectStore('worlds').getAll(),
    )) as PersistenceWorldRecord[];
    await done;
    return worlds
      .filter((world) => isSupportedGeneratorVersion(world.generatorVersion))
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map(({ worldId, seedText, generatorVersion, updatedAt }) => ({
        worldId,
        seedText,
        generatorVersion,
        updatedAt,
      }));
  } finally {
    opened.close();
  }
}

export async function deleteStoredWorld(databaseName: string, worldId: string) {
  if (!worldId.trim()) throw new Error('World identity is invalid.');
  const opened = await openPersistenceDatabase(databaseName);
  try {
    const transaction = opened.transaction(['worlds', 'chunks'], 'readwrite', { durability: 'strict' });
    const done = persistenceTransactionDone(transaction);
    const worlds = transaction.objectStore('worlds');
    if (!(await requestPersistenceResult(worlds.get(worldId)))) throw new Error('Stored world does not exist.');
    worlds.delete(worldId);
    transaction.objectStore('chunks').delete(worldChunkRange(worldId));
    await done;
    return { deleted: true as const, worldId };
  } finally {
    opened.close();
  }
}
