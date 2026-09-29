import type { AuthorityGameplayView } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import type { WorldCommitResult } from '@seedlands/stdlib/server/game-server-types';
import type { KernelWorldgenProviderIdentity } from '@seedlands/kernel/spatial';
import type { PendingMeshTask } from '../app-contracts';
import type { VoxelSemanticsDefinition, VoxelSemanticsRegistry } from '@seedlands/stdlib/world/voxel-semantics';
import type { VoxelGeometryDefinitionV1, VoxelGeometryRegistryV1 } from '@seedlands/stdlib/mod-api';

export type WorldAuthorityPort = Readonly<{
  seedText: string;
  seed: number;
  generatorVersion: number;
  worldgenProvider: KernelWorldgenProviderIdentity;
  mutationCount: number;
  worldRevision: number;
  worldTime: number;
  physicsTick: number;
  commitSequence: number;
  gameplay: AuthorityGameplayView;
  voxelSemantics: VoxelSemanticsRegistry;
  voxelGeometry?: VoxelGeometryRegistryV1;
  ensureChunkNeighborhood(cx: number, cy: number, cz: number): Promise<void>;
  releasePreparation(cx: number, cy: number, cz: number): void;
  releaseChunkNeighborhood(cx: number, cy: number, cz: number): void;
  prepareWorkerInput(
    cx: number,
    cy: number,
    cz: number,
  ): {
    chunkRevision: number;
    generatorVersion: number;
    provider?: KernelWorldgenProviderIdentity;
    canonical?: Uint16Array;
    fluid?: Uint8Array;
    voxelSemantics?: readonly VoxelSemanticsDefinition[];
    voxelGeometry?: readonly VoxelGeometryDefinitionV1[];
    overlays: Array<{ cx: number; cy: number; cz: number; voxels: Uint16Array; fluid?: Uint8Array }>;
  };
  acceptWorkerCanonical(
    task: PendingMeshTask,
    result: Readonly<{
      canonical?: ArrayBuffer;
      generatorVersion?: number;
      provider?: KernelWorldgenProviderIdentity;
    }>,
  ): boolean | Promise<boolean>;
  getVoxel(x: number, y: number, z: number): number;
  getFluidCell(x: number, y: number, z: number): { level: number; source: boolean } | null;
  getChunkRevision(cx: number, cy: number, cz: number): number | null;
  setFluidActiveChunks(keys: readonly string[]): void;
  editWorld(
    actorId: string,
    edits: readonly { x: number; y: number; z: number; value: number }[],
  ): Promise<WorldCommitResult>;
  setWorldTime(hours: number): Promise<{ worldTime: number }>;
}>;
