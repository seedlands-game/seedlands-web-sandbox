import { createStoredChunkRecord, storedChunkRecordBytes, type StoredChunkRecord } from '../world/chunk-snapshot-codec';
import type { FrozenGameSaveSnapshot } from '../server/persistence/game-save-snapshot';
import { readGameSaveCheckpoint } from '../server/persistence/game-save-checkpoint';

export type FrozenSaveTaskSnapshot = Omit<FrozenGameSaveSnapshot, 'chunks'> & {
  chunks: Array<
    Omit<FrozenGameSaveSnapshot['chunks'][number], 'voxels' | 'fluid'> & {
      voxels: ArrayBuffer;
      fluid?: ArrayBuffer;
    }
  >;
};

type Config = Readonly<{ worldId: string; seedText: string; generatorVersion: number }>;
type WorldRecord = {
  worldId: string;
  seedText: string;
  generatorVersion: number;
  player: [number, number, number] | null;
  gameplaySnapshot?: unknown;
  commitSequence?: number;
  worldRevision?: number;
  updatedAt: number;
};

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

export async function persistFrozenGameSnapshot(options: {
  database: IDBDatabase;
  config: Config;
  snapshot: FrozenSaveTaskSnapshot;
  proceduralChunk: (cx: number, cy: number, cz: number) => Uint16Array;
  normalizeRecord: (value: unknown) => StoredChunkRecord;
}) {
  const { config, snapshot } = options;
  const checkpoint = readGameSaveCheckpoint(snapshot)!;
  if (
    snapshot.seedText !== config.seedText ||
    snapshot.generatorVersion !== config.generatorVersion ||
    !Number.isSafeInteger(snapshot.commitSequence) ||
    snapshot.commitSequence < 0
  )
    throw new Error('Frozen game snapshot does not match the active world.');
  const startedAt = performance.now();
  const records = snapshot.chunks.map((chunk) =>
    createStoredChunkRecord({
      worldId: config.worldId,
      seedText: config.seedText,
      cx: chunk.cx,
      cy: chunk.cy,
      cz: chunk.cz,
      revision: chunk.revision,
      formatVersion: 1,
      voxelSchemaVersion: 1,
      generatorVersion: config.generatorVersion,
      voxels: new Uint16Array(chunk.voxels),
      proceduralVoxels: options.proceduralChunk(chunk.cx, chunk.cy, chunk.cz),
      ...(chunk.fluid ? { fluid: new Uint8Array(chunk.fluid) } : {}),
    }),
  );
  const encodeMs = performance.now() - startedAt;
  const transaction = options.database.transaction(['worlds', 'chunks'], 'readwrite', { durability: 'strict' });
  const done = transactionDone(transaction);
  try {
    const worlds = transaction.objectStore('worlds');
    const chunks = transaction.objectStore('chunks');
    const existingWorld = (await requestResult(worlds.get(config.worldId))) as WorldRecord | undefined;
    if (!existingWorld) throw new Error('Stored world metadata is missing.');
    if ((existingWorld.commitSequence ?? 0) > snapshot.commitSequence)
      throw new Error('Refusing to replace a newer frozen game checkpoint.');
    for (const record of records) {
      const existingValue = await requestResult(chunks.get([record.worldId, record.cx, record.cy, record.cz]));
      if (existingValue !== undefined) {
        const existing = options.normalizeRecord(existingValue);
        if (existing.revision > record.revision)
          throw new Error(`Refusing to replace Chunk ${record.cx},${record.cy},${record.cz} with an older revision.`);
        if (existing.revision === record.revision && existing.payloadChecksum !== record.payloadChecksum)
          throw new Error(`Chunk ${record.cx},${record.cy},${record.cz} revision conflicts with stored content.`);
      }
      chunks.put(record);
    }
    worlds.put({
      ...existingWorld,
      gameplaySnapshot: snapshot.gameplay,
      commitSequence: snapshot.commitSequence,
      worldRevision: checkpoint.worldRevision,
      updatedAt: Date.now(),
    } satisfies WorldRecord);
    await done;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // Transaction may already be aborted by IndexedDB.
    }
    await done.catch(() => undefined);
    throw error;
  }
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
}
