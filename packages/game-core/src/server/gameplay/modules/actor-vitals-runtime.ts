import type { GameplayResult } from '../gameplay-runtime';
import type { PlayerState } from '../player-state';
import type { EntityStore } from '../entity-store';

export class ActorVitalsRuntime {
  constructor(
    private readonly options: Readonly<{
      player(id: string): PlayerState;
      killPlayer(player: PlayerState): void;
      touch(): void;
      entities: EntityStore;
    }>,
  ) {}
  applyDamage(_actorId: string, playerId: string, amount: number, _cause: string): GameplayResult {
    const player = this.options.player(playerId);
    if (!Number.isFinite(amount) || amount <= 0) return { success: false, reason: 'invalid-damage' };
    if (player.lifecycle === 'dead') return { success: false, reason: 'player-dead' };
    if (player.mode === 'creative') return { success: true };
    player.health = Math.max(0, player.health - amount);
    if (player.health === 0) this.options.killPlayer(player);
    this.options.touch();
    return { success: true };
  }

  healPlayer(playerId: string, amount: number): GameplayResult {
    const player = this.options.player(playerId);
    if (player.lifecycle === 'dead') return { success: false, reason: 'player-dead' };
    if (!Number.isFinite(amount) || amount <= 0) return { success: false, reason: 'invalid-heal' };
    player.health = Math.min(player.maxHealth, player.health + amount);
    this.options.touch();
    return { success: true };
  }

  setHungerForDebug(playerId: string, hunger: number): void {
    if (!Number.isFinite(hunger) || hunger < 0 || hunger > 20) throw new TypeError('Hunger must be between 0 and 20.');
    this.options.player(playerId).hunger = hunger;
    this.options.touch();
  }

  respawnPlayer(playerId: string): GameplayResult {
    const player = this.options.player(playerId);
    if (player.lifecycle !== 'dead') return { success: false, reason: 'player-alive' };
    player.respawn();
    this.options.entities.move(playerId, player.spawnPosition);
    this.options.touch();
    return { success: true };
  }
}
