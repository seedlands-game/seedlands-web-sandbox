import type { SerializedChunkSnapshot } from './browser-world-save';
import type { WorldOpenMode } from '@seedlands/stdlib/runtime/world-version-policy';
import type { KernelWorldgenProviderIdentity } from '@seedlands/kernel/spatial';
import type { VoxelSemanticsDefinition } from '@seedlands/stdlib/world/voxel-semantics';
import { MAX_VOXEL_ID, Voxel, chunkKey } from '@seedlands/stdlib/world/voxel';

export type BrowserChunkOpenOptions = Readonly<{
  databaseName?: string;
  legacySnapshots?: readonly SerializedChunkSnapshot[];
  openMode?: WorldOpenMode;
  provider: KernelWorldgenProviderIdentity;
  voxelSemantics?: readonly VoxelSemanticsDefinition[];
}>;

export const voxelStorageIdsForOpen = (options: BrowserChunkOpenOptions): readonly number[] =>
  options.voxelSemantics
    ? options.voxelSemantics.map((definition) => definition.storageId)
    : Array.from({ length: MAX_VOXEL_ID + 1 }, (_, storageId) => storageId);

export const validLegacySnapshot = (
  snapshot: SerializedChunkSnapshot,
  seedText: string,
  generatorVersion: number,
  options: BrowserChunkOpenOptions,
): boolean =>
  snapshot.seedText === seedText &&
  snapshot.generatorVersion === generatorVersion &&
  snapshot.key === chunkKey(snapshot.cx, snapshot.cy, snapshot.cz) &&
  Number.isInteger(snapshot.revision) &&
  snapshot.revision >= 0 &&
  snapshot.voxels.length === 32 ** 3 &&
  snapshot.voxels.every(
    (voxel) =>
      Number.isInteger(voxel) &&
      voxel >= Voxel.Air &&
      (options.voxelSemantics
        ? options.voxelSemantics.some((definition) => definition.storageId === voxel)
        : voxel <= MAX_VOXEL_ID),
  );
