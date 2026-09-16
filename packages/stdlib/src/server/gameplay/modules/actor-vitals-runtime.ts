import type { GameplayResult } from '../gameplay-runtime';
import type { PlayerState } from '../player-state';
import type { EntityStore } from '../entity-store';
import type { ActorComponentSnapshot } from '../ecs-actor-components';
import { prepareEntityMutation } from '../prepared-entity-mutation';
import { advancePlayerNeeds } from './needs-runtime';
import { emptyInventoryCursor } from './inventory-pointer-contract';

export class ActorVitalsRuntime {
  constructor(
    private readonly options: Readonly<{
      player(id: string): PlayerState;
      assertCanChange(): void;
      assertCanCancelCombat(id: string): void;
      cancelCombat(id: string): void;
      touch(event?: boolean): void;
      entities: EntityStore;
    }>,
  ) {}
  applyDamage(_actorId: string, playerId: string, amount: number, _cause: string): GameplayResult {
    const player = this.options.player(playerId);
    if (!Number.isFinite(amount) || amount <= 0) return { success: false, reason: 'invalid-damage' };
    if (player.lifecycle === 'dead') return { success: false, reason: 'player-dead' };
    if (player.mode === 'creative') return { success: true };
    this.commit(playerId, Math.max(0, player.health - amount), this.options.entities.actorComponentSnapshot(playerId));
    return { success: true };
  }

  advanceNeeds(id: string, seconds: number): void {
    const player = this.options.player(id);
    if (player.lifecycle !== 'alive' || player.mode !== 'survival') return;
    const candidate = player.snapshot();
    advancePlayerNeeds(candidate, seconds, () => {
      candidate.lifecycle = 'dead';
    });
    const components = this.options.entities.actorComponentSnapshot(id);
    this.commit(
      id,
      candidate.health,
      {
        ...components,
        needs: {
          ...components.needs,
          hunger: candidate.hunger,
          hungerAccumulator: candidate.hungerAccumulator,
          healingAccumulator: candidate.healingAccumulator,
          starvationAccumulator: candidate.starvationAccumulator,
        },
      },
      false,
    );
  }

  private commit(id: string, health: number, components: ActorComponentSnapshot, event = true): void {
    const dead = health === 0;
    const entity = this.options.entities.get(id)!;
    this.options.assertCanChange();
    if (dead) this.options.assertCanCancelCombat(id);
    const cursorStack = components.inventoryCursor?.stack;
    const spawns = dead
      ? [...components.inventory, cursorStack].flatMap((stack) => (stack ? [{ position: entity.position, stack }] : []))
      : [];
    const candidate = dead
      ? {
          ...components,
          lifecycle: 'dead' as const,
          inventory: components.inventory.map(() => null),
          inventoryCursor: cursorStack
            ? { ...emptyInventoryCursor(), revision: (components.inventoryCursor?.revision ?? 0) + 1 }
            : components.inventoryCursor,
          player: { ...components.player!, breakAction: null },
        }
      : components;
    const prepared = prepareEntityMutation(this.options.entities, {
      actors: [{ reference: this.options.entities.createReference(id)!, health, components: candidate }],
      spawns,
    });
    prepared.validate();
    prepared.apply();
    if (dead) this.options.cancelCombat(id);
    this.options.touch(event);
  }

  healPlayer(playerId: string, amount: number): GameplayResult {
    const player = this.options.player(playerId);
    if (player.lifecycle === 'dead') return { success: false, reason: 'player-dead' };
    if (!Number.isFinite(amount) || amount <= 0) return { success: false, reason: 'invalid-heal' };
    this.commit(
      playerId,
      Math.min(player.maxHealth, player.health + amount),
      this.options.entities.actorComponentSnapshot(playerId),
    );
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
