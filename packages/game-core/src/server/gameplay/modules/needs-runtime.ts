import type { PlayerState } from '../player-state';

export function advancePlayerNeeds(player: PlayerState, seconds: number, kill: () => void): void {
  player.hungerAccumulator += seconds;
  while (player.hungerAccumulator >= 120) {
    player.hungerAccumulator -= 120;
    player.hunger = Math.max(0, player.hunger - 1);
  }
  if (player.hunger >= 16 && player.health < player.maxHealth) {
    player.healingAccumulator += seconds;
    while (player.healingAccumulator >= 10 && player.hunger >= 16 && player.health < player.maxHealth) {
      player.healingAccumulator -= 10;
      player.health += 1;
      player.hunger -= 1;
    }
  } else player.healingAccumulator = 0;
  if (player.hunger === 0) {
    player.starvationAccumulator += seconds;
    while (player.starvationAccumulator >= 15 && player.lifecycle === 'alive') {
      player.starvationAccumulator -= 15;
      player.health = Math.max(0, player.health - 1);
      if (player.health === 0) kill();
    }
  } else player.starvationAccumulator = 0;
}
