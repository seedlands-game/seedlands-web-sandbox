import type { PlayerControllerOptions } from './player-controller-types';

type DebugTimeOptions = Pick<
  PlayerControllerOptions,
  'getEnvironment' | 'onToggleDebug' | 'onToggleCollisionDebug' | 'onSetWorldClockPaused' | 'onSetWorldClockSpeed'
>;

export class PlayerDebugTimeKeys {
  private debugModifierHeld = false;

  constructor(private readonly options: DebugTimeOptions) {}

  handleKeyDown(event: KeyboardEvent): boolean {
    if (event.code === 'F3') {
      event.preventDefault();
      this.debugModifierHeld = true;
      if (!event.repeat) this.options.onToggleDebug();
      return true;
    }
    if (event.code === 'KeyB' && this.debugModifierHeld) {
      event.preventDefault();
      if (!event.repeat) this.options.onToggleCollisionDebug();
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
    if (code === 'F3') this.debugModifierHeld = false;
  }

  clear(): void {
    this.debugModifierHeld = false;
  }
}
