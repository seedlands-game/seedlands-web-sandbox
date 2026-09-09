import type { MeshAuthorityOverlay } from '../world/mesh';
import type { ChunkCoord } from '../world/voxel';
import type { GameplayPersistence } from './persistence/gameplay-persistence';
import type { ChunkPersistence } from './persistence/chunk-persistence';
import type { EntitySpawn, EntityUpdate, GameplayEntity } from './gameplay/entity-store';
import type { VoxelEdit, WorldMutationBuffer } from './world-mutation';
import type { CanonicalChunkResidencyLimits } from './chunk-residency';
import type { CorePlatformPorts } from '../runtime/platform-ports';
import type { GameplayContent } from './gameplay/gameplay-content';
import type { WorldComposition } from './composition/contracts';

export type ServerChunk = ChunkCoord & {
  key: string;
  voxels: Uint16Array;
  revision: number;
  persistedRevision: number;
  dirty: boolean;
  materialized: boolean;
  accessEpoch: number;
  fluid: Uint8Array;
};
export type WorldSemanticEventInput = { type: string; subjectId: string; data?: unknown };
export type WorldSemanticEvent = WorldSemanticEventInput & { worldRevision: number };
export type WorldEditBatch = {
  actorId: string;
  edits?: readonly VoxelEdit[];
  buffers?: readonly WorldMutationBuffer[];
  semanticEvents?: readonly WorldSemanticEventInput[];
};
export type VoxelRegionChanged = {
  type: 'voxel-region-changed';
  actorId: string;
  worldRevision: number;
  mutationCount: number;
  chunks: string[];
  chunkRevisions: Array<{ key: string; revision: number }>;
  meshChunks: string[];
  bounds: { min: [number, number, number]; max: [number, number, number] } | null;
};
export type WorldCommitMetrics = {
  timingStatus: 'measured' | 'not-collected-hot-path';
  inputMutationCount: number;
  canonicalWriteCount: number;
  dirtyChunkCount: number;
  meshInvalidationCount: number;
  structuralEventCount: 0 | 1;
  semanticEventCount: number;
  mutationPayloadBytes: number;
  mutationCapacityBytes: number;
  validationMs: number;
  resolveMs: number;
  applyMs: number;
  commitMs: number;
};
export type WorldCollisionCellDelta = Readonly<{ index: number; voxel: number; fluid: number }>;
export type WorldCollisionChunkDelta = Readonly<{
  key: string;
  previousRevision: number;
  revision: number;
  cells: readonly WorldCollisionCellDelta[];
}>;
export type AuthorityCollisionBaselineResult =
  | Readonly<{ status: 'unavailable'; key: string }>
  | Readonly<{
      status: 'available';
      key: string;
      chunkRevision: number;
      canonical: ArrayBuffer;
      fluid: ArrayBuffer;
    }>;
export type WorldCommitResult = {
  committed: boolean;
  reason?: 'chunk-unavailable';
  worldRevision: number;
  structuralChange: VoxelRegionChanged | null;
  semanticEvents: readonly WorldSemanticEvent[];
  collisionDelta?: readonly WorldCollisionChunkDelta[];
  metrics: WorldCommitMetrics;
};
export type ServerEntity = GameplayEntity;
export type EntityCreate = EntitySpawn;
export type { EntityUpdate };
export type GameServerOptions = {
  seedText: string;
  platform: CorePlatformPorts;
  content?: GameplayContent;
  composition?: WorldComposition;
  allowLegacyCompositionMigration?: boolean;
  generatorVersion?: number;
  persistence?: ChunkPersistence & Partial<GameplayPersistence>;
  canonicalResidency?: Partial<CanonicalChunkResidencyLimits>;
  onUnknownChunk?: (key: string) => void;
  fluidEpoch?: number;
};
export type DerivedMeshSnapshot = {
  key: string;
  cx: number;
  cy: number;
  cz: number;
  canonical: Uint16Array;
  halo: Uint16Array;
  fluid: Uint8Array;
  fluidHalo: Uint8Array;
  chunkRevision: number;
  haloRevision: string;
  proceduralVoxelSamples: number;
  macroContextCount: number;
};
export type WorkerMeshPreparation = {
  key: string;
  cx: number;
  cy: number;
  cz: number;
  chunkRevision: number;
  generatorVersion: number;
  canonical?: Uint16Array;
  fluid?: Uint8Array;
  overlays: MeshAuthorityOverlay[];
};
export type WorkerCanonicalResult = Pick<
  WorkerMeshPreparation,
  'key' | 'cx' | 'cy' | 'cz' | 'chunkRevision' | 'generatorVersion'
> & { canonical: Uint16Array };
