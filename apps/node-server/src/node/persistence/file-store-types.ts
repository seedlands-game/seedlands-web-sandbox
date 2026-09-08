import type { ChunkRecordCodec } from '@seedlands/game-core/world/chunk-snapshot-codec';
import type { GameSaveCheckpoint } from '@seedlands/game-core/server/persistence/game-save-checkpoint';

export const FILE_STORE_VERSION = 1 as const;

export type FileStoreLimits = Readonly<{
  maxSeedBytes: number;
  maxManifestBytes: number;
  maxBlobBytes: number;
  maxGameplayBytes: number;
  maxChunks: number;
}>;

export const DEFAULT_FILE_STORE_LIMITS: FileStoreLimits = Object.freeze({
  maxSeedBytes: 1_024,
  maxManifestBytes: 16 * 1_024 * 1_024,
  maxBlobBytes: 2 * 1_024 * 1_024,
  maxGameplayBytes: 64 * 1_024 * 1_024,
  maxChunks: 100_000,
});

export type FileReference = Readonly<{
  path: string;
  bytes: number;
  sha256: string;
}>;

export type ChunkFileReference = FileReference &
  Readonly<{
    key: string;
    cx: number;
    cy: number;
    cz: number;
    revision: number;
    codec: ChunkRecordCodec;
    fluidVersion?: 1;
  }>;

export type FileStoreManifest = Readonly<{
  version: typeof FILE_STORE_VERSION;
  worldId: string;
  seedText: string;
  generatorVersion: number;
  gameSaveSchemaVersion: 1;
  gameplaySchemaVersion: 3;
  physicsSchema: Readonly<{ version: 1; bodyRegistryVersion: 1 }>;
  fluidSchema: Readonly<{ version: 1; encoding: 'chunk-level-source-byte' }>;
  checkpoint: GameSaveCheckpoint;
  gameplay: FileReference;
  chunks: Readonly<Record<string, ChunkFileReference>>;
}>;

export type FileStorePointer = Readonly<{
  version: typeof FILE_STORE_VERSION;
  manifest: string;
  bytes: number;
  sha256: string;
  checkpoint: GameSaveCheckpoint;
}>;

export type PreviousCheckpointInspection = Readonly<{
  checkpoint: GameSaveCheckpoint;
  chunkKeys: readonly string[];
  manifestPath: string;
}>;

export type FileGamePersistenceFaultStage =
  | 'after-chunk-blobs'
  | 'after-gameplay-blob'
  | 'after-manifest'
  | 'after-previous-pointer'
  | 'before-current-pointer'
  | 'after-current-pointer';
