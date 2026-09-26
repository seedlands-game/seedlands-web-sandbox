import type { VoxelTarget } from '../../client/presentation/voxel-target';

export const CREATIVE_BREAK_HOLD_SECONDS = 0.25;
export const CREATIVE_BREAK_REPEAT_SECONDS = 0.2;

export type MiningMode = 'creative' | 'survival';

/**
 * Keeps held creative breaking independent of render-frame count. A late frame
 * consumes at most one interval, so it cannot replay missed break requests.
 */
export class CreativeBreakCadence {
  private heldSeconds = 0;
  private nextBreakSeconds = CREATIVE_BREAK_HOLD_SECONDS;

  start(): void {
    this.heldSeconds = 0;
    this.nextBreakSeconds = CREATIVE_BREAK_HOLD_SECONDS;
  }

  stop(): void {
    this.start();
  }

  advance(elapsedSeconds: number): boolean {
    this.heldSeconds += Math.max(0, Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0);
    if (this.heldSeconds + Number.EPSILON < this.nextBreakSeconds) return false;
    this.nextBreakSeconds = this.heldSeconds + CREATIVE_BREAK_REPEAT_SECONDS;
    return true;
  }
}

/** Holds the input-only state that must not leak a delayed creative request into a later press. */
export class PlayerMiningState {
  private modeValue: MiningMode | null = null;
  private activeTarget: string | null = null;
  private activeMode: MiningMode | null = null;
  private readonly creativeCadence = new CreativeBreakCadence();
  private creativeRequestInFlight = false;
  private creativeRequestGeneration = 0;

  get mode(): MiningMode | null {
    return this.modeValue;
  }

  matchesMode(isCreativeMode: (() => boolean) | undefined): boolean {
    return this.modeValue === (isCreativeMode?.() ? 'creative' : 'survival');
  }

  start(mode: MiningMode): void {
    this.modeValue = mode;
    this.creativeCadence.start();
  }

  shouldBegin(targetKey: string, elapsedSeconds: number, initial: boolean): boolean {
    if (targetKey === this.activeTarget) return false;
    if (this.modeValue !== 'creative') return true;
    if (!initial && !this.creativeCadence.advance(elapsedSeconds)) return false;
    return !this.creativeRequestInFlight;
  }

  recordBegin(targetKey: string, request: void | Promise<void>): void {
    const mode = this.modeValue ?? 'survival';
    this.activeTarget = targetKey;
    this.activeMode = mode;
    if (mode !== 'creative' || !(request instanceof Promise)) return;
    const generation = ++this.creativeRequestGeneration;
    this.creativeRequestInFlight = true;
    void request.then(
      () => this.finishCreativeRequest(generation),
      () => this.finishCreativeRequest(generation),
    );
  }

  cancelActive(): boolean {
    if (!this.activeTarget) return false;
    const shouldCancel = this.activeMode === 'survival';
    this.activeTarget = null;
    this.activeMode = null;
    return shouldCancel;
  }

  stop(): boolean {
    this.modeValue = null;
    this.creativeCadence.stop();
    this.creativeRequestGeneration += 1;
    this.creativeRequestInFlight = false;
    return this.cancelActive();
  }

  private finishCreativeRequest(generation: number): void {
    if (generation === this.creativeRequestGeneration) this.creativeRequestInFlight = false;
  }
}

export function sameVoxelTarget(previous: VoxelTarget | null, target: VoxelTarget | null): boolean {
  const adjacentEqual =
    previous?.adjacent === target?.adjacent ||
    Boolean(
      previous?.adjacent &&
      target?.adjacent &&
      previous.adjacent.every((value, index) => value === target.adjacent![index]),
    );
  return (
    previous === target ||
    Boolean(
      previous &&
      target &&
      previous.voxel === target.voxel &&
      previous.inRange === target.inRange &&
      previous.position.every((value, index) => value === target.position[index]) &&
      adjacentEqual,
    )
  );
}
