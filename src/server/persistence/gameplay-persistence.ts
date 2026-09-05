import type { GameplaySnapshot } from '../gameplay/gameplay-runtime';
import type { FrozenGameSaveSnapshot } from './game-save-snapshot';

export interface GameplayPersistence {
  loadGameplaySnapshot(): unknown | Promise<unknown>;
  saveGameplaySnapshot(snapshot: GameplaySnapshot): void | Promise<void>;
  saveFrozenSnapshot?(snapshot: FrozenGameSaveSnapshot): void | Promise<void>;
  loadLegacyPlayerPosition?(): [number, number, number] | null | Promise<[number, number, number] | null>;
}
