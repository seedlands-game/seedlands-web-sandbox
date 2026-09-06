import type { GameplaySnapshot } from '../gameplay/gameplay-runtime';
import { cloneFrozenGameSaveSnapshot, type FrozenGameSaveSnapshot } from './game-save-snapshot';
import type { GameplayPersistence } from './gameplay-persistence';
import { MemoryChunkPersistence } from './memory-chunk-persistence';
import { readGameSaveCheckpoint, type GameSaveCheckpoint } from './game-save-checkpoint';

type Options = {
  legacyPlayerPosition?: [number, number, number];
  rawGameplaySnapshot?: unknown;
};

const clone = <Value>(value: Value): Value => structuredClone(value);

export class MemoryGamePersistence extends MemoryChunkPersistence implements GameplayPersistence {
  private gameplaySnapshot: unknown;
  private readonly legacyPlayerPosition: [number, number, number] | null;
  private nextFailure: Error | null = null;
  private checkpoint: GameSaveCheckpoint | null = null;

  constructor(options: Options = {}) {
    super();
    this.gameplaySnapshot = clone(options.rawGameplaySnapshot ?? null);
    this.legacyPlayerPosition = options.legacyPlayerPosition ? [...options.legacyPlayerPosition] : null;
  }

  loadGameplaySnapshot(): unknown {
    return clone(this.gameplaySnapshot);
  }

  loadGameCheckpoint(): GameSaveCheckpoint | null {
    return this.checkpoint ? { ...this.checkpoint } : null;
  }

  saveGameplaySnapshot(snapshot: GameplaySnapshot): void {
    this.consumeFailure();
    this.gameplaySnapshot = clone(snapshot);
  }

  saveFrozenSnapshot(snapshot: FrozenGameSaveSnapshot): void {
    this.consumeFailure();
    const copy = cloneFrozenGameSaveSnapshot(snapshot);
    const checkpoint = readGameSaveCheckpoint(copy)!;
    if (this.checkpoint && checkpoint.commitSequence < this.checkpoint.commitSequence)
      throw new Error('Refusing to replace a newer frozen game checkpoint.');
    this.commitSnapshots(copy.chunks);
    this.gameplaySnapshot = copy.gameplay;
    this.checkpoint = checkpoint;
  }

  private consumeFailure(): void {
    if (this.nextFailure) {
      const failure = this.nextFailure;
      this.nextFailure = null;
      throw failure;
    }
  }

  loadLegacyPlayerPosition(): [number, number, number] | null {
    return this.legacyPlayerPosition ? [...this.legacyPlayerPosition] : null;
  }

  failNextGameplaySave(error: Error): void {
    this.nextFailure = error;
  }

  failNextFrozenSave(error: Error): void {
    this.nextFailure = error;
  }
}
