import type { ChunkPersistenceCorpusSummary } from './browser-persistence-metrics';

export type BrowserPersistenceWorkerSuccess = { requestId: number; ok: true; result: unknown };
export type BrowserPersistenceWorkerFailure = { requestId: number; ok: false; error: string };
export type BrowserPersistenceWorkerResponse = BrowserPersistenceWorkerSuccess | BrowserPersistenceWorkerFailure;

export type BrowserPersistenceInitResult = {
  worldId: string;
  generatorVersion: number;
  player: [number, number, number] | null;
  gameplaySnapshot: unknown;
  checkpoint?: unknown;
  corpusSummary: ChunkPersistenceCorpusSummary | null;
  legacyMigrated: boolean;
};

export type BrowserPersistenceSaveResult = {
  saved: Array<{ key: string; revision: number }>;
  recordBytes: number;
  encodeMs: number;
  codecs: Record<string, number>;
};
