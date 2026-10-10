import type { Page } from '@playwright/test';
import type { ClassicWindow } from './harness';

/** Read-only durable metadata observation in the existing native input journey. */
export const observePersistedChunkDirectory = (page: Page) =>
  page.evaluate(async () => {
    const identity = await (window as unknown as ClassicWindow).__seedlandsHarness!.world.identity();
    if (!identity.ok) throw new Error(identity.error.message);
    const worldId = identity.data.worldId;
    if (typeof worldId !== 'string' || !worldId) throw new Error('Persisted directory world identity is unavailable.');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('seedlands-chunks-v1', 1);
      request.onupgradeneeded = () => {
        request.transaction?.abort();
        reject(new Error('Expected existing persistence database; observation must not initialize it.'));
      };
      request.onerror = () => reject(request.error ?? new Error('Persistence metadata observation failed.'));
      request.onsuccess = () => resolve(request.result);
    });
    try {
      const transaction = database.transaction('worlds', 'readonly');
      const done = new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error ?? new Error('Persistence observation aborted.'));
        transaction.onerror = () => reject(transaction.error ?? new Error('Persistence observation failed.'));
      });
      const request = transaction.objectStore('worlds').get(worldId);
      const [record] = await Promise.all([
        new Promise<{ chunkDirectoryRevision?: unknown } | undefined>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error ?? new Error('Persisted world metadata read failed.'));
        }),
        done,
      ]);
      const revision = record?.chunkDirectoryRevision;
      if (!Number.isSafeInteger(revision) || (revision as number) < 0)
        throw new Error('Durable chunk directory revision is unavailable or invalid.');
      return { worldId, revision: revision as number };
    } finally {
      database.close();
    }
  });
