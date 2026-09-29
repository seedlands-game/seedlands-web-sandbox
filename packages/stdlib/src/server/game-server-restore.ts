import type { FrozenGameSaveSnapshot } from './persistence/game-save-snapshot';
import type { ChunkSnapshot } from './persistence/chunk-persistence';
import type { VoxelSemanticsResolver } from '../world/voxel-semantics';
import { isValidChunkSnapshot } from './persistence/validate-chunk-snapshot';
import { assertStationCheckpointIntegrity } from './station-world-integrity';
import type { StationStateCodec } from './gameplay/ecs-station-state';

export const validateServerStationCheckpoint = (snapshot: FrozenGameSaveSnapshot, codec?: StationStateCodec): void =>
  assertStationCheckpointIntegrity(snapshot, codec);

export const validServerChunkSnapshot = (
  snapshot: ChunkSnapshot,
  expected: Readonly<{ seedText: string; generatorVersion: number; key: string; cx: number; cy: number; cz: number }>,
  semantics?: VoxelSemanticsResolver,
): boolean => isValidChunkSnapshot(snapshot, expected, semantics);
