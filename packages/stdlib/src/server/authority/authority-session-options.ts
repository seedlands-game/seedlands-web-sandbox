import type { BodyConfig } from '../../physics';
import type { LoadedVoxelSource } from './voxel-collision-world';
import type * as SessionContract from './authority-session-types';
import type { AuthorityKernelExecutionPort } from './authority-kernel-state';

export type AuthoritySessionOptions = Readonly<{
  epoch: string;
  playerId: string;
  server: SessionContract.AuthorityServerPort;
  bodyConfigFor: (entity: SessionContract.AuthorityEntity) => BodyConfig;
  voxelSource: LoadedVoxelSource;
  frequencies: Readonly<{ physicsHz: number; gameplayHz: number; fluidHz: number }>;
  startTimeMs: number;
  requestUnknownChunk?: (chunkKey: string) => void;
  requestFluidWork?: (elapsedPeriods: number) => void;
  publishLogicObservation?: (snapshot: SessionContract.AuthoritySnapshot) => void;
  worldHoursPerSecond?: number;
  measureNow?: () => number;
  execution: AuthorityKernelExecutionPort;
}>;
