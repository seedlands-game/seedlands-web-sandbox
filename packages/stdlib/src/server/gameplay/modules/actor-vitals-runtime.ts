import type { GameplayResult } from '../gameplay-runtime';
import type { PlayerState } from '../player-state';
import type { EntityStore } from '../entity-store';
import type { ActorComponentSnapshot } from '../ecs-actor-components';
import type { ArmorEquipment } from '../ecs-actor-armor-state';
import { prepareEntityMutation, type PreparedEntityMutation } from '../prepared-entity-mutation';
import { advancePlayerNeeds } from './needs-runtime';
import { emptyInventoryCursor } from './inventory-pointer-contract';
import {
  buildDeathInventorySettlementCandidateV1,
  prepareDeathInventorySettlementSeriesV1,
} from '../death-inventory-settlement';
import type { DeathInventoryPolicyCapabilityV1 } from './death-inventory-policy-module';

type ActorVitalsDeathInventoryMode =
  Readonly<{ kind: 'legacy' }> | Readonly<{ kind: 'composed'; capability: DeathInventoryPolicyCapabilityV1 | null }>;

type PreparedEffect = Readonly<{ validate(): void; apply(): void }>;

export class ActorVitalsRuntime {
  constructor(
    private readonly options: Readonly<{
      player(id: string): PlayerState;
      assertCanChange(): void;
      prepareDeaths(ids: readonly string[]): PreparedEffect;
      deathInventory: ActorVitalsDeathInventoryMode;
      touch(event?: boolean): void;
      entities: EntityStore;
    }>,
  ) {}
  applyDamage(
    _actorId: string,
    playerId: string,
    amount: number,
    _cause: string,
    armor?: ArmorEquipment,
  ): GameplayResult {
    const player = this.options.player(playerId);
    if (!Number.isFinite(amount) || amount <= 0) return { success: false, reason: 'invalid-damage' };
    if (player.lifecycle === 'dead') return { success: false, reason: 'player-dead' };
    if (player.mode === 'creative') return { success: true };
    const components = this.options.entities.actorComponentSnapshot(playerId);
    return this.commit(
      playerId,
      Math.max(0, player.health - amount),
      armor ? { ...components, equipment: { ...components.equipment, armor } } : components,
    );
  }

  advanceNeeds(id: string, seconds: number): void {
    const player = this.options.player(id);
    if (player.lifecycle !== 'alive' || player.mode !== 'survival') return;
    const candidate = player.snapshot();
    advancePlayerNeeds(candidate, seconds, () => {
      candidate.lifecycle = 'dead';
    });
    const components = this.options.entities.actorComponentSnapshot(id);
    const result = this.commit(
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
    if (!result.success) throw new Error(result.reason);
  }

  private commit(id: string, health: number, components: ActorComponentSnapshot, event = true): GameplayResult {
    const dead = health === 0;
    const entity = this.options.entities.get(id)!;
    if (dead && this.options.deathInventory.kind === 'composed' && !this.options.deathInventory.capability)
      return { success: false, reason: 'death-inventory-policy-unavailable' };
    this.options.assertCanChange();
    const reference = this.options.entities.createReference(id)!;
    const sourceComponents = this.options.entities.actorComponentSnapshot(id);
    let prepared: PreparedEntityMutation;
    if (dead && this.options.deathInventory.kind === 'composed') {
      const settlementComponents = {
        ...components,
        player: { ...components.player!, breakAction: null },
      };
      const candidate = buildDeathInventorySettlementCandidateV1({
        source: { actorReference: reference, health: entity.health!, components: sourceComponents },
        position: entity.position,
        settlementComponents,
        policy: this.options.deathInventory.capability!.policyFor('player'),
      });
      prepared = prepareDeathInventorySettlementSeriesV1(this.options.entities, { candidates: [candidate] });
    } else {
      prepared = this.prepareLegacyMutation(reference, health, components, entity.position, dead);
    }
    const effects = dead ? this.options.prepareDeaths([id]) : null;
    prepared.validate();
    effects?.validate();
    prepared.apply();
    effects?.apply();
    this.options.touch(event);
    return { success: true };
  }

  private prepareLegacyMutation(
    reference: NonNullable<ReturnType<EntityStore['createReference']>>,
    health: number,
    components: ActorComponentSnapshot,
    position: readonly [number, number, number],
    dead: boolean,
  ) {
    const cursorStack = components.inventoryCursor?.stack;
    const interactionItems = [cursorStack, ...(components.inventoryCursor?.craftingGrid ?? [])];
    const spawns = dead
      ? [...components.inventory, ...interactionItems].flatMap((stack) => (stack ? [{ position, stack }] : []))
      : [];
    const candidate = dead
      ? {
          ...components,
          lifecycle: 'dead' as const,
          inventory: components.inventory.map(() => null),
          inventoryCursor: interactionItems.some(Boolean)
            ? { ...emptyInventoryCursor(), revision: (components.inventoryCursor?.revision ?? 0) + 1 }
            : components.inventoryCursor,
          player: { ...components.player!, breakAction: null },
        }
      : components;
    return prepareEntityMutation(this.options.entities, {
      actors: [{ reference, health, components: candidate }],
      spawns,
    });
  }

  healPlayer(playerId: string, amount: number): GameplayResult {
    const player = this.options.player(playerId);
    if (player.lifecycle === 'dead') return { success: false, reason: 'player-dead' };
    if (!Number.isFinite(amount) || amount <= 0) return { success: false, reason: 'invalid-heal' };
    return this.commit(
      playerId,
      Math.min(player.maxHealth, player.health + amount),
      this.options.entities.actorComponentSnapshot(playerId),
    );
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
