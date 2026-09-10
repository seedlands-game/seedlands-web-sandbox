import { ActorInventoryRuntime } from './modules/actor-inventory-runtime';
import { ActorVitalsRuntime } from './modules/actor-vitals-runtime';
import { BlockInteractionRuntime } from './modules/block-interaction-runtime';
import type { EntityStore } from './entity-store';
import type { GameplayContent } from './gameplay-content';
import type { GameplayCallbacks } from './gameplay-runtime-contracts';
import type { PlayerState } from './player-state';
import type { AutonomyRuntime } from '../simulation/autonomy-runtime';

/** Existing domain facades share the same instance owners, including uncomposed test hosts. */
export function createGameplayDomainAdapters(
  options: Readonly<{
    entities: EntityStore;
    content: GameplayContent;
    callbacks: GameplayCallbacks;
    player(id: string): PlayerState;
    simulation(): AutonomyRuntime;
    assertCanChange(): void;
    changed(inventory: boolean, event?: boolean): void;
  }>,
) {
  const { entities, content, callbacks, player, simulation, assertCanChange, changed } = options;
  const inventory = new ActorInventoryRuntime({
    actor: (id) => entities.actorStateAccess(id),
    recipes: content.recipes,
    entities: entities,
    getVoxel: callbacks.getVoxel,
    assertCanChange: assertCanChange,
    assertCanCancelCombat: (id) => simulation().assertCanCancelCombat(id),
    cancelCombat: (id, reason) => simulation().cancelCombat(id, reason),
    prepareCancelCombat: (id) => simulation().prepareCancellation([id], 'slot-changed'),
    changed,
  });
  const vitals = new ActorVitalsRuntime({
    player: player,
    assertCanChange: assertCanChange,
    assertCanCancelCombat: (id) => simulation().assertCanCancelCombat(id),
    cancelCombat: (id) => {
      simulation().cancelCombat(id, 'attacker-dead');
    },
    touch: (event) => changed(false, event),
    entities: entities,
  });
  const blocks = new BlockInteractionRuntime({
    player: player,
    entity: (id) => entities.get(id),
    getVoxel: callbacks.getVoxel,
    prepareVoxelEdit: callbacks.prepareVoxelEdit,
    entities: entities,
    assertCanChange: assertCanChange,
    items: content.items,
    changed,
  });
  return { inventory, vitals, blocks };
}
