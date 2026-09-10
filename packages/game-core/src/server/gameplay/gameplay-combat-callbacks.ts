import { isActorEntityType } from './ecs-actor-state';
import type { EntityStore } from './entity-store';
import type { PlayerState } from './player-state';
import type { AutonomyRuntime } from '../simulation/autonomy-runtime';
import type { ActorVitalsRuntime } from './modules/actor-vitals-runtime';
import type { CombatRuntimeCallbacks } from './combat-runtime';
import { applyCombatDamage, isCombatantAvailable, validateCombatHit } from './gameplay-combat';

/** Shared geometry checks and the uncomposed compatibility damage adapter. */
export function createGameplayCombatCallbacks(
  options: Readonly<{
    entities: EntityStore;
    players: ReadonlyMap<string, PlayerState>;
    simulation(): AutonomyRuntime;
    vitals: ActorVitalsRuntime;
    getVoxel(position: [number, number, number]): number | undefined;
    assertCanChange(): void;
    changed(): void;
  }>,
): CombatRuntimeCallbacks {
  const { entities, players } = options;
  const isPlayerAlive = (id: string) => players.get(id)?.lifecycle === 'alive';
  const available = (id: string) => isCombatantAvailable(entities, isPlayerAlive, id);
  return {
    actorAvailable: available,
    targetAvailable: available,
    validateHit: (actorId, targetId, definition) =>
      validateCombatHit({ entities, getVoxel: options.getVoxel, isPlayerAlive }, actorId, targetId, definition),
    applyDamage(actorId, targetId, amount) {
      const target = entities.get(targetId);
      if (target && isActorEntityType(target.type) && entities.actorStateAccess(targetId).mode === 'creative') return 0;
      return applyCombatDamage(
        {
          entities,
          playerState: (id) => players.get(id),
          damagePlayer: (actor, target, damage) => options.vitals.applyDamage(actor, target, damage, 'combat'),
          recordAttacked: (target, actor) => options.simulation().recordAttacked(target, actor),
          cancelTarget: (target, actor) => options.simulation().cancelCombatTarget(target, 'target-missing', actor),
          unregisterActor: (target) => options.simulation().unregisterActor(target, 'killed'),
          actorDeathDrop: (id) => options.simulation().actorDeathDrop(id),
          assertCanRemoveActor: (target, actor) => options.simulation().assertCanRemoveActor(target, actor),
          assertCanChange: options.assertCanChange,
          touch: options.changed,
        },
        actorId,
        targetId,
        amount,
      );
    },
  };
}
