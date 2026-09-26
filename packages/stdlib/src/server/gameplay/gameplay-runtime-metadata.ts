import type { KernelStateOwner } from '@seedlands/kernel/execution';

export abstract class GameplayRuntimeMetadata {
  abstract readonly kernelState: KernelStateOwner;
  protected abstract readonly persistedRevision: number;

  get gameplayTime(): number {
    return this.kernelState.gameplayTime;
  }

  get gameplayRevision(): number {
    return this.kernelState.gameplayRevision;
  }

  get persistedGameplayRevision(): number {
    return this.persistedRevision;
  }
}
