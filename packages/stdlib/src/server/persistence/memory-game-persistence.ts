import type { GameplaySnapshot } from '../gameplay/gameplay-runtime';
import { cloneFrozenGameSaveSnapshot, type FrozenGameSaveSnapshot } from './game-save-snapshot';
import type { GameplayPersistence } from './gameplay-persistence';
import { MemoryChunkPersistence } from './memory-chunk-persistence';
import { readGameSaveCheckpoint, type GameSaveCheckpoint } from './game-save-checkpoint';
import type { CoreClone } from '../../runtime/platform-ports';

type Options = {
  clone: CoreClone;
  legacyPlayerPosition?: [number, number, number];
  rawGameplaySnapshot?: unknown;
};

export class MemoryGamePersistence extends MemoryChunkPersistence implements GameplayPersistence {
  private gameplaySnapshot: unknown;
  private readonly legacyPlayerPosition: [number, number, number] | null;
  private nextFailure: Error | null = null;
  private checkpoint: GameSaveCheckpoint | null = null;

  constructor(private readonly options: Options) {
    super();
    if (typeof options?.clone !== 'function')
      throw new TypeError('MemoryGamePersistence requires an explicit structured clone port.');
    this.gameplaySnapshot = options.clone(options.rawGameplaySnapshot ?? null);
    this.legacyPlayerPosition = options.legacyPlayerPosition ? [...options.legacyPlayerPosition] : null;
  }

  loadGameplaySnapshot(): unknown {
    return this.options.clone(this.gameplaySnapshot);
  }

  loadGameCheckpoint(): GameSaveCheckpoint | null {
    return this.checkpoint ? { ...this.checkpoint } : null;
  }

  saveGameplaySnapshot(snapshot: GameplaySnapshot): void {
    this.consumeFailure();
    this.gameplaySnapshot = this.options.clone(snapshot);
  }

  saveFrozenSnapshot(snapshot: FrozenGameSaveSnapshot): void {
    this.consumeFailure();
    const copy = cloneFrozenGameSaveSnapshot(snapshot, this.options.clone);
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
