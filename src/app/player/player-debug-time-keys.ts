import type { PlayerControllerOptions } from './player-controller-types';

type DebugTimeOptions = Pick<
  PlayerControllerOptions,
  'getEnvironment' | 'onToggleDebug' | 'onToggleCollisionDebug' | 'onSetWorldClockPaused' | 'onSetWorldClockSpeed'
>;

export class PlayerDebugTimeKeys {
  private debugModifierHeld = false;
  private collisionChordConsumed = false;

  constructor(private readonly options: DebugTimeOptions) {}

  handleKeyDown(event: KeyboardEvent): boolean {
    if (event.code === 'F3') {
      event.preventDefault();
      if (!event.repeat) {
        this.debugModifierHeld = true;
        this.collisionChordConsumed = false;
      }
      return true;
    }
    if (event.code === 'KeyB' && this.debugModifierHeld) {
      event.preventDefault();
      if (!event.repeat) {
        this.collisionChordConsumed = true;
        this.options.onToggleCollisionDebug();
      }
      return true;
    }
    const environment = this.options.getEnvironment();
    if (event.code === 'KeyP' && environment) {
      this.options.onSetWorldClockPaused(!environment.paused);
      return true;
    }
    if (event.code === 'KeyT' && environment) {
      this.options.onSetWorldClockSpeed(environment.speed === 1 ? 20 : environment.speed === 20 ? 100 : 1);
      return true;
    }
    return false;
  }

  handleKeyUp(code: string): void {
    if (code !== 'F3' || !this.debugModifierHeld) return;
    if (!this.collisionChordConsumed) this.options.onToggleDebug();
    this.clear();
  }

  clear(): void {
    this.debugModifierHeld = false;
    this.collisionChordConsumed = false;
  }
}
