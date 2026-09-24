import type { FluidCell } from './fluid/fluid-cell';
import type { WorldCommitResult, WorldEditBatch } from './game-server-types';
import type { ExpectedWorldVoxelEdit, PreparedWorldEditBatch } from './world-transaction-commit';
import type { PreparedWorldEdit } from './prepared-world-edit';
import type { VoxelGeometryResolver } from '../world/voxel-model';

export type GameServerGameplayWorldPort = Readonly<{
  voxelGeometry?: VoxelGeometryResolver;
  seed(): number;
  worldTime(): number;
  getVoxel(x: number, y: number, z: number): number;
  editBatch(batch: WorldEditBatch): WorldCommitResult;
  prepareVoxelEdit(actorId: string, position: readonly [number, number, number], voxel: number): PreparedWorldEdit;
  prepareVoxelEdits(actorId: string, edits: readonly ExpectedWorldVoxelEdit[]): PreparedWorldEditBatch;
  setWorldTime(hours: number): number;
  readLoadedGameplayVoxel(x: number, y: number, z: number): number | undefined;
  readGameplayVoxel(x: number, y: number, z: number): number | undefined;
  readFluidCell(x: number, y: number, z: number): FluidCell | null;
  biomeAt(x: number, z: number): string;
}>;
