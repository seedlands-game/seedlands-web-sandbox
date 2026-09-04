import type { GameplaySnapshotV1 } from '../gameplay/gameplay-runtime';
import type { GameplayPersistence } from './gameplay-persistence';
import { MemoryChunkPersistence } from './memory-chunk-persistence';

type Options = {
  legacyPlayerPosition?: [number, number, number];
  rawGameplaySnapshot?: unknown;
};

const clone = <Value>(value: Value): Value => structuredClone(value);

export class MemoryGamePersistence extends MemoryChunkPersistence implements GameplayPersistence {
  private gameplaySnapshot: unknown;
  private readonly legacyPlayerPosition: [number, number, number] | null;
  private nextFailure: Error | null = null;

  constructor(options: Options = {}) {
    super();
    this.gameplaySnapshot = clone(options.rawGameplaySnapshot ?? null);
    this.legacyPlayerPosition = options.legacyPlayerPosition ? [...options.legacyPlayerPosition] : null;
  }

  loadGameplaySnapshot(): unknown {
    return clone(this.gameplaySnapshot);
  }

  saveGameplaySnapshot(snapshot: GameplaySnapshotV1): void {
    if (this.nextFailure) {
      const failure = this.nextFailure;
      this.nextFailure = null;
      throw failure;
    }
    this.gameplaySnapshot = clone(snapshot);
  }

  loadLegacyPlayerPosition(): [number, number, number] | null {
    return this.legacyPlayerPosition ? [...this.legacyPlayerPosition] : null;
  }

  failNextGameplaySave(error: Error): void {
    this.nextFailure = error;
  }
}
