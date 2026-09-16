export type ChunkPersistenceCorpusSummary = {
  storedChunkCount: number;
  rawBytes: number;
  legacyJsonBytes: number;
  recordBytes: number;
  payloadBytes: number;
  metadataBytes: number;
  codecs: Record<string, number>;
};

export type BrowserPersistenceMetrics = {
  idbGetCount: number;
  loadTransactionCount: number;
  idbPutCount: number;
  encodedChunkCount: number;
  decodedChunkCount: number;
  recordBytes: number;
  encodeMs: number;
  decodeSamplesMs: number[];
  codecs: Record<string, number>;
};

export const createBrowserPersistenceMetrics = (): BrowserPersistenceMetrics => ({
  idbGetCount: 0,
  loadTransactionCount: 0,
  idbPutCount: 0,
  encodedChunkCount: 0,
  decodedChunkCount: 0,
  recordBytes: 0,
  encodeMs: 0,
  decodeSamplesMs: [],
  codecs: {},
});
