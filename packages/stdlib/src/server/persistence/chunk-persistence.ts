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
  sharedDependencyCount?: number;
  foundCount: number;
  missingCount: number;
  queueWaitMs: number;
  databaseMs: number;
  transactionReadMs: number;
  decodeMs: number;
  totalWorkerMs: number;
  mailboxWaitMs?: number;
  mailboxEncodingTaskKind?: string;
  mailboxEncodingOverlapMs?: number;
  mailboxEncodingDurationMs?: number;
  replyDeliveryMs?: number;
  roundTripMs?: number;
  measurementStatus?: Readonly<Partial<Record<ChunkPersistenceMeasurementField, ChunkPersistenceMeasurementStatus>>>;
  codecs: Readonly<Record<string, number>>;
}>;

export type ChunkPersistencePreparedStatus = 'found' | 'missing' | 'unknown';

/** Point-in-time durable directory observation; consumers must fence their world and subsequent writes. */
export type ChunkColumnDirectory =
  | Readonly<{
      status: 'complete';
      revision: number;
      entries: readonly Readonly<ChunkCoord & { key: string; revision: number }>[];
    }>
  | Readonly<{ status: 'unknown'; reason: 'source-unavailable' | 'invalid-data' | 'budget-exhausted' | 'superseded' }>;

export type ChunkPersistenceMeasurementStatus = 'measured' | 'not-collected' | 'unsupported';

export type ChunkPersistenceMeasurementField =
  'queueWaitMs' | 'databaseMs' | 'transactionReadMs' | 'decodeMs' | 'totalWorkerMs' | 'roundTripMs';

export interface ChunkPersistence {
  inspectColumnDirectory?(cx: number, cz: number): Promise<ChunkColumnDirectory>;
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
  /** Releases prepared read cache only; durable data remains available for a later ensure. */
  evictSnapshot?(key: string): void;
}
