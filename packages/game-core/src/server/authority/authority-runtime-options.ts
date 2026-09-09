import type { CorePlatformPorts } from '../../runtime/platform-ports';
import type { WorldComposition } from '../composition/contracts';
import type { FluidAuthoritySnapshot } from '../fluid/fluid-transaction';
import type { CanonicalChunkResidencyLimits } from '../chunk-residency';
import type { ChunkPersistence } from '../persistence/chunk-persistence';
import type { GameplayPersistence } from '../persistence/gameplay-persistence';
import type { LogicObservation } from '../logic/logic-protocol';
import type { AuthorityFrequencies, AuthorityInitialWorldBootstrap } from './authority-runtime-types';

export type AuthorityPersistence = ChunkPersistence &
  Partial<GameplayPersistence> & { metrics?: () => Readonly<{ recordBytes: number }> };

export type AuthorityRuntimeOptions = Readonly<{
  epoch: string;
  seedText: string;
  platform: CorePlatformPorts;
  composition?: WorldComposition;
  allowLegacyCompositionMigration?: boolean;
  persistence?: AuthorityPersistence;
  generatorVersion?: number;
  initialWorldTime: number;
  startTimeMs: number;
  startClock?: () => number;
  initialPlayerBodyPosition?: [number, number, number];
  findInitialWorldBootstrap?: (seed: number, generatorVersion: number) => Promise<AuthorityInitialWorldBootstrap>;
  frequencies?: AuthorityFrequencies;
  onFluidWork?: (snapshot: FluidAuthoritySnapshot) => void;
  onLogicObservation?: (observation: LogicObservation) => void;
  onUnknownChunk?: (key: string) => void;
  canonicalResidency?: Partial<CanonicalChunkResidencyLimits>;
  fluidEpoch?: number;
}>;
