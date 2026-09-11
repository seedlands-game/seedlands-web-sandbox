import { describe, expect, it, vi } from 'vitest';
import { Game } from '../../../src/app/game';

describe('Game companion pause propagation', () => {
  it('notifies the companion synchronously even before a world environment exists', () => {
    const companion = { setPaused: vi.fn() };
    const game = Object.assign(Object.create(Game.prototype), {
      paused: false,
      companion,
      controller: null,
      authority: null,
      gameplayClient: null,
      worldAudio: null,
      camera: null,
      world: null,
    }) as Game;

    game.setPaused(true);

    expect(companion.setPaused).toHaveBeenCalledWith(true);
  });
});
