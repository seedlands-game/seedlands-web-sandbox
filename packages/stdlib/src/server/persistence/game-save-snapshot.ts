import type { GameplaySnapshotV4 } from '../gameplay/gameplay-runtime';
import type { ChunkSnapshot } from './chunk-persistence';
import type { CoreClone } from '../../runtime/platform-ports';

export const GAME_SAVE_SCHEMA_VERSION = 1 as const;
export const GAME_SAVE_FLUID_SCHEMA = Object.freeze({
  version: 1 as const,
  encoding: 'chunk-level-source-byte' as const,
});

export type FrozenGameSaveSnapshot = Readonly<{
  version: typeof GAME_SAVE_SCHEMA_VERSION;
  commitSequence: number;
  seedText: string;
  generatorVersion: number;
  worldRevision: number;
  physicsSchema: GameplaySnapshotV4['physicsSchema'];
  fluidSchema: typeof GAME_SAVE_FLUID_SCHEMA;
  gameplay: GameplaySnapshotV4;
  chunks: readonly ChunkSnapshot[];
}>;

export const cloneFrozenGameSaveSnapshot = (
  snapshot: FrozenGameSaveSnapshot,
  clone: CoreClone,
): FrozenGameSaveSnapshot => clone(snapshot);
