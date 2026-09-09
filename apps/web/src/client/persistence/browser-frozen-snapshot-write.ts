import type { FrozenGameSaveSnapshot } from '@seedlands/game-core/server/persistence/game-save-snapshot';
import type { BrowserPersistenceMetrics } from './browser-persistence-metrics';
import type { BrowserPersistenceSaveResult } from './browser-persistence-worker-contract';

export const prepareFrozenSnapshotWrite = (snapshot: FrozenGameSaveSnapshot) => {
  const copy = structuredClone(snapshot);
  const transfers = copy.chunks.flatMap((chunk) => [
    chunk.voxels.buffer as Transferable,
    ...(chunk.fluid ? [chunk.fluid.buffer as Transferable] : []),
  ]);
  return {
    message: {
      snapshot: {
        ...copy,
        chunks: copy.chunks.map((chunk) => ({
          ...chunk,
          voxels: chunk.voxels.buffer,
          ...(chunk.fluid ? { fluid: chunk.fluid.buffer } : {}),
        })),
      },
    },
    transfers,
  };
};

export const recordFrozenSnapshotWrite = (metrics: BrowserPersistenceMetrics, result: BrowserPersistenceSaveResult) => {
  metrics.idbPutCount += result.saved.length + 1;
  metrics.encodedChunkCount += result.saved.length;
  metrics.recordBytes += result.recordBytes;
  metrics.encodeMs += result.encodeMs;
  Object.entries(result.codecs).forEach(([codec, count]) => {
    metrics.codecs[codec] = (metrics.codecs[codec] ?? 0) + count;
  });
};
