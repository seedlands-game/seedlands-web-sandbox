import type { ChunkColumnDirectory } from '@seedlands/stdlib/server/persistence/chunk-persistence';
import { chunkKey } from '@seedlands/stdlib/world/voxel';
import { worldgenProviderIdentityKey } from '@seedlands/kernel/spatial';
import type { PersistenceWorkerConfig, PersistenceWorldRecord } from './persistence-worker-protocol';
import { persistenceTransactionDone, requestPersistenceResult } from './persistence-indexeddb';

export const COLUMN_DIRECTORY_LIMITS = Object.freeze({ maxEntries: 128, maxVisits: 2048 });
type Config = Pick<PersistenceWorkerConfig, 'worldId' | 'seedText' | 'generatorVersion' | 'provider'>;
const unknown = (reason: Extract<ChunkColumnDirectory, { status: 'unknown' }>['reason']): ChunkColumnDirectory => ({
  status: 'unknown',
  reason,
});
function sameProvider(world: PersistenceWorldRecord, config: Config): boolean {
  try {
    return (
      !!world.provider && worldgenProviderIdentityKey(world.provider) === worldgenProviderIdentityKey(config.provider)
    );
  } catch {
    return false;
  }
}

/** Projects metadata without decode or prepared-cache consumption; matched IDB gets still clone stored records. */
export async function inspectPersistenceColumnDirectory(
  database: IDBDatabase,
  config: Config,
  cx: number,
  cz: number,
  limits: Readonly<{ maxEntries: number; maxVisits: number }> = COLUMN_DIRECTORY_LIMITS,
): Promise<ChunkColumnDirectory> {
  if (
    !Number.isSafeInteger(cx) ||
    !Number.isSafeInteger(cz) ||
    !Number.isSafeInteger(limits.maxEntries) ||
    limits.maxEntries < 1 ||
    limits.maxEntries > COLUMN_DIRECTORY_LIMITS.maxEntries ||
    !Number.isSafeInteger(limits.maxVisits) ||
    limits.maxVisits < 1 ||
    limits.maxVisits > COLUMN_DIRECTORY_LIMITS.maxVisits
  )
    throw new RangeError('Column directory coordinates or budget are invalid.');
  const transaction = database.transaction(['worlds', 'chunks'], 'readonly');
  const done = persistenceTransactionDone(transaction);
  try {
    const world = (await requestPersistenceResult(transaction.objectStore('worlds').get(config.worldId))) as
      PersistenceWorldRecord | undefined;
    let result = unknown('source-unavailable');
    if (world) {
      const revision = world.chunkDirectoryRevision;
      if (
        world.seedText !== config.seedText ||
        world.generatorVersion !== config.generatorVersion ||
        !sameProvider(world, config) ||
        !Number.isSafeInteger(revision) ||
        (revision as number) < 0
      )
        result = unknown('invalid-data');
      else {
        const store = transaction.objectStore('chunks');
        const range = IDBKeyRange.bound(
          [config.worldId, cx, -Infinity, -Infinity],
          [config.worldId, cx, Infinity, Infinity],
        );
        result = await scanColumn(store, range, config, cx, cz, revision as number, limits);
      }
    }
    await done;
    return result;
  } catch (error) {
    await done.catch(() => undefined);
    throw error;
  }
}

function scanColumn(
  store: IDBObjectStore,
  range: IDBKeyRange,
  config: Config,
  cx: number,
  cz: number,
  revision: number,
  limits: Readonly<{ maxEntries: number; maxVisits: number }>,
): Promise<ChunkColumnDirectory> {
  const entries: Array<{ cx: number; cy: number; cz: number; key: string; revision: number }> = [];
  let visits = 0;
  return new Promise((resolve, reject) => {
    const request = store.openKeyCursor(range);
    request.onerror = () => reject(request.error ?? new Error('Column directory cursor failed.'));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve({ status: 'complete', revision, entries });
        return;
      }
      if (++visits > limits.maxVisits) {
        resolve(unknown('budget-exhausted'));
        return;
      }
      const key = cursor.primaryKey;
      if (
        !Array.isArray(key) ||
        key.length !== 4 ||
        key[0] !== config.worldId ||
        key[1] !== cx ||
        !Number.isSafeInteger(key[2]) ||
        !Number.isSafeInteger(key[3])
      ) {
        resolve(unknown('invalid-data'));
        return;
      }
      const cy = key[2] as number;
      const storedCz = key[3] as number;
      if (storedCz !== cz) {
        // Seek to the requested z within this y, or past this y when z has already passed.
        cursor.continue(storedCz < cz ? [config.worldId, cx, cy, cz] : [config.worldId, cx, cy + 1, -Infinity]);
        return;
      }
      if (entries.length >= limits.maxEntries) {
        resolve(unknown('budget-exhausted'));
        return;
      }
      const read = store.get(key);
      read.onerror = () => reject(read.error ?? new Error('Column directory entry failed.'));
      read.onsuccess = () => {
        const record = read.result;
        const canonical = chunkKey(cx, cy, cz);
        if (
          !record ||
          record.worldId !== config.worldId ||
          record.seedText !== config.seedText ||
          record.generatorVersion !== config.generatorVersion ||
          record.cx !== cx ||
          record.cy !== cy ||
          record.cz !== cz ||
          !Number.isSafeInteger(record.revision) ||
          record.revision < 0
        ) {
          resolve(unknown('invalid-data'));
          return;
        }
        entries.push({ cx, cy, cz, key: canonical, revision: record.revision });
        cursor.continue();
      };
    };
  });
}
