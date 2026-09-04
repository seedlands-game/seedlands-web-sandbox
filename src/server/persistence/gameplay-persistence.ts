import type { GameplaySnapshot } from '../gameplay/gameplay-runtime';

export interface GameplayPersistence {
  loadGameplaySnapshot(): unknown | Promise<unknown>;
  saveGameplaySnapshot(snapshot: GameplaySnapshot): void | Promise<void>;
  loadLegacyPlayerPosition?(): [number, number, number] | null | Promise<[number, number, number] | null>;
}
