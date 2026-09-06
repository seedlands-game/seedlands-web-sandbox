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
