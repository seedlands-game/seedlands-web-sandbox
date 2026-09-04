import type { GameplaySnapshotV1 } from '../gameplay/gameplay-runtime';

export interface GameplayPersistence {
  loadGameplaySnapshot(): unknown | Promise<unknown>;
  saveGameplaySnapshot(snapshot: GameplaySnapshotV1): void | Promise<void>;
  loadLegacyPlayerPosition?(): [number, number, number] | null | Promise<[number, number, number] | null>;
}
