import type { ChunkCoord } from '../../world/voxel';

export type ChunkSnapshot = ChunkCoord & {
  key: string;
  seedText: string;
  generatorVersion: number;
  revision: number;
  voxels: Uint16Array;
  fluidVersion?: 1;
  fluid?: Uint8Array;
};

export type ChunkPersistenceLoadDiagnostics = Readonly<{
  requestedKeyCount: number;
  foundCount: number;
  missingCount: number;
  queueWaitMs: number;
  databaseMs: number;
  transactionReadMs: number;
  decodeMs: number;
  totalWorkerMs: number;
  codecs: Readonly<Record<string, number>>;
}>;

export type ChunkPersistencePreparedStatus = 'found' | 'missing' | 'unknown';

export interface ChunkPersistence {
  loadSnapshot(key: string): ChunkSnapshot | null;
  saveSnapshots(snapshots: readonly ChunkSnapshot[]): void | Promise<void>;
  ensureSnapshot?(cx: number, cy: number, cz: number): Promise<void>;
  ensureNeighborhood?(
    cx: number,
    cy: number,
    cz: number,
    residentKeys?: readonly string[],
  ): Promise<ChunkPersistenceLoadDiagnostics | void>;
  preparedSnapshotStatus?(key: string): ChunkPersistencePreparedStatus;
  releaseNeighborhood?(cx: number, cy: number, cz: number): void;
  evictSnapshot?(key: string): void;
}
