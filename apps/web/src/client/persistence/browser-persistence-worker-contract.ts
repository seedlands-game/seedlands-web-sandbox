import type { ChunkPersistenceCorpusSummary } from './browser-persistence-metrics';
import type { KernelWorldgenProviderIdentity } from '@seedlands/kernel/spatial';

export type BrowserPersistenceWorkerSuccess = { requestId: number; ok: true; result: unknown };
export type BrowserPersistenceWorkerFailure = { requestId: number; ok: false; error: string };
export type BrowserPersistenceWorkerResponse = BrowserPersistenceWorkerSuccess | BrowserPersistenceWorkerFailure;

export type BrowserPersistenceInitResult = {
  worldId: string;
  generatorVersion: number;
  provider: KernelWorldgenProviderIdentity;
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
