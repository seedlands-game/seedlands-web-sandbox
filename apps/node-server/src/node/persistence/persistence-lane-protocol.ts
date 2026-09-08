import type {
  ChunkPersistenceLoadDiagnostics,
  ChunkSnapshot,
} from '@seedlands/game-core/server/persistence/chunk-persistence';
import type { GameSaveCheckpoint } from '@seedlands/game-core/server/persistence/game-save-checkpoint';
import type { FrozenGameSaveSnapshot } from '@seedlands/game-core/server/persistence/game-save-snapshot';
import type { FileStoreLimits, PreviousCheckpointInspection } from './file-store-types';

export const PERSISTENCE_LANE_PROTOCOL_VERSION = 1 as const;

export type PersistenceLaneIdentity = Readonly<{
  worldId: string;
  seedText: string;
  generatorVersion: number;
}>;

export type PersistenceLaneCacheLimits = Readonly<{
  maxCachedChunks: number;
  maxCachedBytes: number;
  maxRetainedSaveBytes: number;
}>;

export const DEFAULT_PERSISTENCE_LANE_CACHE_LIMITS: PersistenceLaneCacheLimits = Object.freeze({
  maxCachedChunks: 256,
  maxCachedBytes: 512 * 1_024 * 1_024,
  maxRetainedSaveBytes: 256 * 1_024 * 1_024,
});

export type PersistenceLaneRequestKind =
  | 'persistence-open'
  | 'persistence-ensure'
  | 'persistence-ensure-neighborhood'
  | 'persistence-save-frozen'
  | 'persistence-inspect-previous'
  | 'persistence-close';

export type PersistenceOpenRequest = Readonly<{
  version: typeof PERSISTENCE_LANE_PROTOCOL_VERSION;
  identity: PersistenceLaneIdentity;
}>;

export type PersistenceOpenResponse = Readonly<{
  version: typeof PERSISTENCE_LANE_PROTOCOL_VERSION;
  identity: PersistenceLaneIdentity;
  gameplay: unknown;
  checkpoint: GameSaveCheckpoint | null;
  storeLimits?: FileStoreLimits;
}>;

export type PersistenceEnsureRequest = Readonly<{
  key: string;
  cx: number;
  cy: number;
  cz: number;
}>;

export type PersistenceEnsureResult = Readonly<{
  key: string;
  status: 'found' | 'missing';
  snapshot?: ChunkSnapshot;
}>;

export type PersistenceNeighborhoodRequest = Readonly<{
  cx: number;
  cy: number;
  cz: number;
  residentKeys: readonly string[];
}>;

export type PersistenceNeighborhoodResponse = Readonly<{
  entries: readonly PersistenceEnsureResult[];
  diagnostics: ChunkPersistenceLoadDiagnostics;
}>;

export type PersistenceSaveRequest = Readonly<{
  snapshot: FrozenGameSaveSnapshot;
}>;

export type PersistenceSaveResponse = Readonly<{
  checkpoint: GameSaveCheckpoint;
}>;

export type PersistenceInspectPreviousResponse = Readonly<{
  inspection: PreviousCheckpointInspection | null;
}>;

export type PersistenceLaneDiagnostics = Readonly<{
  cachedChunkCount: number;
  cachedChunkBytes: number;
  missingChunkCount: number;
  prepareMetadataCount: number;
  retainedSaveBytes: number;
  durableCheckpoint: GameSaveCheckpoint | null;
  rpc: unknown;
}>;
