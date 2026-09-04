import type { ChunkCoord } from '../../world/voxel';

export type ChunkSnapshot = ChunkCoord & {
  key: string;
  seedText: string;
  generatorVersion: number;
  revision: number;
  voxels: Uint16Array;
};

export interface ChunkPersistence {
  loadSnapshot(key: string): ChunkSnapshot | null;
  saveSnapshots(snapshots: readonly ChunkSnapshot[]): void;
}
