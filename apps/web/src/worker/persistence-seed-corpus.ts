import {
  createStoredChunkRecord,
  storedChunkRecordBytes,
  type StoredChunkRecord,
} from '@seedlands/stdlib/world/chunk-snapshot-codec';
import { Voxel } from '@seedlands/stdlib/world/voxel';
import { browserCorePlatform } from '../platform/core-platform';
import { commitChunkDirectoryMutation } from './persistence-chunk-directory-revision';
import { worldChunkRange } from './persistence-world-directory';
import {
  persistenceTransactionDone as transactionDone,
  requestPersistenceResult as requestResult,
} from './persistence-indexeddb';
import type {
  PersistenceCorpusSummary as CorpusSummary,
  PersistenceWorldRecord as WorldRecord,
  PersistenceWorkerConfig,
} from './persistence-worker-protocol';

type Config = Pick<PersistenceWorkerConfig, 'worldId' | 'seedText' | 'generatorVersion' | 'provider'>;
type ProceduralChunk = (cx: number, cy: number, cz: number) => Uint16Array;

const corpusVoxels = (index: number, count: number, proceduralChunk: ProceduralChunk) => {
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

export const seedPersistenceCorpus = async (options: {
  database: IDBDatabase;
  config: Config;
  chunkCount: number;
  proceduralChunk: ProceduralChunk;
}): Promise<CorpusSummary> => {
  const { database: opened, config, chunkCount, proceduralChunk } = options;
  if (!Number.isInteger(chunkCount) || chunkCount < 1 || chunkCount > 1_024)
    throw new Error('Chunk corpus size must be between 1 and 1,024.');
  await commitChunkDirectoryMutation(opened, config.worldId, (chunks) => {
    chunks.delete(worldChunkRange(config.worldId));
  });

  const summary: CorpusSummary = {
    storedChunkCount: chunkCount,
    rawBytes: chunkCount * 32 ** 3 * Uint16Array.BYTES_PER_ELEMENT,
    legacyJsonBytes: 0,
    recordBytes: 0,
    payloadBytes: 0,
    metadataBytes: 0,
    codecs: {},
  };
  const encoder = new TextEncoder();
  const batchSize = 32;
  for (let start = 0; start < chunkCount; start += batchSize) {
    const records: StoredChunkRecord[] = [];
    for (let index = start; index < Math.min(start + batchSize, chunkCount); index += 1) {
      const { procedural, voxels } = corpusVoxels(index, chunkCount, proceduralChunk);
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
      const recordBytes = storedChunkRecordBytes(record, browserCorePlatform.utf8);
      summary.recordBytes += recordBytes;
      summary.payloadBytes += record.payload.byteLength;
      summary.metadataBytes += recordBytes - record.payload.byteLength;
      summary.legacyJsonBytes += encoder.encode(JSON.stringify([...voxels])).byteLength;
      summary.codecs[record.codec] = (summary.codecs[record.codec] ?? 0) + 1;
      records.push(record);
    }
    await commitChunkDirectoryMutation(opened, config.worldId, (chunks) => {
      records.forEach((record) => chunks.put(record));
    });
  }

  const metadataTransaction = opened.transaction('worlds', 'readwrite');
  const metadataDone = transactionDone(metadataTransaction);
  const existing = (await requestResult(metadataTransaction.objectStore('worlds').get(config.worldId))) as
    WorldRecord | undefined;
  if (!existing) {
    await metadataDone;
    throw new Error('Stored world metadata is missing.');
  }
  metadataTransaction.objectStore('worlds').put({
    worldId: config.worldId,
    seedText: config.seedText,
    generatorVersion: config.generatorVersion,
    provider: existing.provider ?? config.provider,
    chunkDirectoryRevision: existing.chunkDirectoryRevision,
    player: null,
    corpusSummary: summary,
    updatedAt: Date.now(),
  } satisfies WorldRecord);
  await metadataDone;
  return summary;
};
