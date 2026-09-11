import type { WorldOpenMode } from '@seedlands/stdlib/runtime/world-version-policy';
import type { FrozenSaveTaskSnapshot } from './persistence-frozen-save';
import type { PersistenceLoadCoordinate } from './persistence-load-batch';
import type { KernelWorldgenProviderIdentity } from '@seedlands/kernel/spatial';

export type PersistenceWorkerConfig = {
  databaseName: string;
  worldId: string;
  seedText: string;
  generatorVersion: number;
  provider: KernelWorldgenProviderIdentity;
};
export type PersistenceInitTask = {
  kind: 'init';
  requestId: number;
  openMode: WorldOpenMode;
} & PersistenceWorkerConfig;
export type PersistenceLoadTask = { kind: 'load'; requestId: number; cx: number; cy: number; cz: number };
export type PersistenceLoadBatchTask = {
  kind: 'load-batch';
  requestId: number;
  requestSentAtEpochMs: number;
  coordinates: PersistenceLoadCoordinate[];
};
export type PersistenceSaveTask = {
  kind: 'save';
  requestId: number;
  snapshots: Array<{
    key: string;
    cx: number;
    cy: number;
    cz: number;
    revision: number;
    voxels: ArrayBuffer;
    fluidVersion?: 1;
    fluid?: ArrayBuffer;
  }>;
};
export type PersistenceSaveMetadataTask = {
  kind: 'save-metadata';
  requestId: number;
  player: [number, number, number];
};
export type PersistenceSaveGameplayTask = { kind: 'save-gameplay'; requestId: number; snapshot: unknown };
export type PersistenceSaveFrozenTask = {
  kind: 'save-frozen' | 'replace-frozen';
  requestId: number;
  snapshot: FrozenSaveTaskSnapshot;
};
type StatsTask = { kind: 'stats'; requestId: number };
export type PersistenceSeedCorpusTask = { kind: 'seed-corpus'; requestId: number; chunkCount: number };
type MarkLegacyMigratedTask = { kind: 'mark-legacy-migrated'; requestId: number };
export type PersistenceLatestWorldTask = { kind: 'latest-world'; requestId: number; databaseName: string };

export type PersistenceWorkerTask =
  | PersistenceInitTask
  | PersistenceLoadTask
  | PersistenceLoadBatchTask
  | PersistenceSaveTask
  | PersistenceSaveMetadataTask
  | PersistenceSaveGameplayTask
  | PersistenceSaveFrozenTask
  | StatsTask
  | PersistenceSeedCorpusTask
  | MarkLegacyMigratedTask
  | PersistenceLatestWorldTask;

export type PersistenceCorpusSummary = {
  storedChunkCount: number;
  rawBytes: number;
  legacyJsonBytes: number;
  recordBytes: number;
  payloadBytes: number;
  metadataBytes: number;
  codecs: Record<string, number>;
};

export type PersistenceWorldRecord = {
  worldId: string;
  seedText: string;
  generatorVersion: number;
  provider: KernelWorldgenProviderIdentity;
  player: [number, number, number] | null;
  gameplaySnapshot?: unknown;
  corpusSummary?: PersistenceCorpusSummary;
  legacyMigrated?: boolean;
  updatedAt: number;
  commitSequence?: number;
  worldRevision?: number;
};

export type PersistenceWorkerSuccess = { requestId: number; ok: true; result: unknown };
export type PersistenceWorkerError = { requestId: number; ok: false; error: string };
