import type { ModuleActorAuthority } from '../composition/gameplay-actor-authority';
import type { ModuleSystemAuthority } from './modules/gameplay-module-schedule';
import type { WorldComposition } from '../composition/contracts';
import type { PreparedWorldEdit } from '../prepared-world-edit';
import type { GameplayContent } from './gameplay-content';
import type { CorePlatformPorts } from '../../runtime/platform-ports';
import type { MeleeDefinition } from './combat-runtime';

type Position = [number, number, number];
export type GameplayCallbacks = {
  getVoxel: (position: Position) => number | undefined;
  prepareVoxelEdit: (actorId: string, position: Position, voxel: number) => PreparedWorldEdit;
  getWorldTime: () => number;
  platform: CorePlatformPorts;
  content?: GameplayContent;
  composition?: WorldComposition;
  moduleSystemAuthority?: ModuleSystemAuthority;
  moduleActorAuthority?: ModuleActorAuthority;
  allowLegacyCompositionMigration?: boolean;
  meleeDefinitions?: readonly MeleeDefinition[];
};
export type GameplayFailure = { success: false; reason: string };
export type GameplayResult<Data extends object = Record<never, never>> = ({ success: true } & Data) | GameplayFailure;

export type {
  GameplaySnapshot,
  GameplaySnapshotV1,
  GameplaySnapshotV2,
  GameplaySnapshotV3,
  GameplaySnapshotV4,
} from './gameplay-snapshot';
