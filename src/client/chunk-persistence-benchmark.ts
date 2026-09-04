import { BrowserChunkPersistence, type ChunkPersistenceCorpusSummary } from './browser-chunk-persistence';
import { Voxel, chunkKey } from '../world/voxel';

export type ChunkPersistenceLoadScenario = ChunkPersistenceCorpusSummary & {
  database: string;
  seedText: string;
  startupChunkScanCount: number;
  decodedChunkCount: number;
  idbGetCount: number;
  residentChunkCount: number;
  residentLimit: number;
  inFlightChunkCount: number;
  codecLane: 'persistence-worker';
  decodeP50Ms: number;
  decodeP95Ms: number;
  storageEstimate: { usage: number; quota: number; persisted: boolean };
};

const benchmarkSessions = new Map<string, BrowserChunkPersistence>();

const percentile = (values: readonly number[], quantile: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))];
};

export async function seedBrowserChunkPersistenceCorpus(
  database: string,
  seedText: string,
  chunkCount: number,
): Promise<ChunkPersistenceCorpusSummary> {
  const persistence = await BrowserChunkPersistence.open(seedText, { databaseName: database });
  try {
    return await persistence.seedCorpus(chunkCount);
  } finally {
    persistence.dispose();
  }
}

export async function runBrowserChunkPersistenceLoadScenario(
  database: string,
  seedText: string,
  activeChunkCount: number,
): Promise<ChunkPersistenceLoadScenario> {
  benchmarkSessions.get(database)?.dispose();
  const persistence = await BrowserChunkPersistence.open(seedText, { databaseName: database });
  const summary = persistence.corpusSummary;
  if (!summary) {
    persistence.dispose();
    throw new Error('Chunk persistence corpus metadata is missing.');
  }
  persistence.resetMetrics();
  const activeIndexes = Array.from({ length: activeChunkCount }, (_, index) =>
    Math.min(summary.storedChunkCount - 1, Math.floor((index * summary.storedChunkCount) / activeChunkCount)),
  );
  await Promise.all(activeIndexes.map((cx) => persistence.ensureSnapshot(cx, 0, 0)));
  const metrics = persistence.metrics();
  const estimate = await navigator.storage.estimate();
  const persisted = (await navigator.storage.persisted?.()) ?? false;
  benchmarkSessions.set(database, persistence);
  return {
    ...summary,
    database,
    seedText,
    startupChunkScanCount: 0,
    decodedChunkCount: metrics.decodedChunkCount,
    idbGetCount: metrics.idbGetCount,
    residentChunkCount: persistence.residentSnapshotCount,
    residentLimit: activeChunkCount,
    inFlightChunkCount: 0,
    codecLane: 'persistence-worker',
    decodeP50Ms: percentile(metrics.decodeSamplesMs, 0.5),
    decodeP95Ms: percentile(metrics.decodeSamplesMs, 0.95),
    storageEstimate: { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0, persisted },
  };
}

export async function saveOneBrowserChunkPersistenceChange(
  database: string,
): Promise<{ encodedChunkCount: number; idbPutCount: number; untouchedChunkReadCount: number }> {
  const persistence = benchmarkSessions.get(database);
  if (!persistence) throw new Error('Chunk persistence load scenario is not active.');
  const snapshot = persistence.loadSnapshot(chunkKey(0, 0, 0));
  if (!snapshot) throw new Error('Active Chunk 0,0,0 is missing.');
  snapshot.voxels[0] = snapshot.voxels[0] === Voxel.Wood ? Voxel.Stone : Voxel.Wood;
  snapshot.revision += 1;
  persistence.resetMetrics();
  await persistence.saveSnapshots([snapshot]);
  const metrics = persistence.metrics();
  return {
    encodedChunkCount: metrics.encodedChunkCount,
    idbPutCount: metrics.idbPutCount,
    untouchedChunkReadCount: metrics.idbGetCount,
  };
}
