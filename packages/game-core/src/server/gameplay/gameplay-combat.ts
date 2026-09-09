import { prepareEntityMutation } from './prepared-entity-mutation';
import type { MeleeDefinition } from './combat-runtime';
import type { EntityStore } from './entity-store';
import { attackTargetPoint, distanceSquared } from './gameplay-geometry';
import type { ItemStack } from './item-registry';
import type { PlayerState } from './player-state';
import { traceVoxelRay } from './voxel-ray';

type CombatValidationContext = Readonly<{
  entities: EntityStore;
  getVoxel: (position: [number, number, number]) => number | undefined;
  isPlayerAlive: (id: string) => boolean;
}>;

export function isCombatantAvailable(
  entities: EntityStore,
  isPlayerAlive: (id: string) => boolean,
  id: string,
): boolean {
  const entity = entities.get(id);
  if (!entity) return false;
  if (entity.type === 'player') return isPlayerAlive(id);
  return (entity.type === 'creature' || entity.type === 'npc') && entity.health !== undefined && entity.health > 0;
}

export function validateCombatHit(
  context: CombatValidationContext,
  actorId: string,
  targetId: string,
  definition: MeleeDefinition,
): string | null {
  const actor = context.entities.get(actorId);
  const target = context.entities.get(targetId);
  const available = (id: string) => isCombatantAvailable(context.entities, context.isPlayerAlive, id);
  if (!actor || !available(actorId)) return 'invalid-attacker';
  if (!target || !available(targetId)) return 'invalid-target';
  const validTarget =
    actor.type === 'player'
      ? target.type === 'creature' || target.type === 'npc'
      : (actor.type === 'creature' || actor.type === 'npc') && target.type === 'player';
  if (!validTarget) return 'invalid-target';
  if (distanceSquared(actor.position, target.position) > definition.range ** 2) return 'out-of-range';
  const visibility = traceVoxelRay(attackTargetPoint(actor), attackTargetPoint(target), (x, y, z) =>
    context.getVoxel([x, y, z]),
  );
  return visibility === 'clear' ? null : visibility === 'unavailable' ? 'chunk-unavailable' : 'blocked';
}

type CombatDamageContext = Readonly<{
  entities: EntityStore;
  playerState: (id: string) => PlayerState | undefined;
  damagePlayer: (actorId: string, targetId: string, damage: number) => unknown;
  recordAttacked: (targetId: string, actorId: string) => void;
  cancelTarget: (targetId: string, actorId: string) => void;
  unregisterActor: (targetId: string) => ItemStack | null;
  actorDeathDrop: (id: string) => ItemStack | null;
  assertCanRemoveActor: (targetId: string, actorId: string) => void;
  assertCanChange: () => void;
  touch: () => void;
}>;

export function applyCombatDamage(
  context: CombatDamageContext,
  actorId: string,
  targetId: string,
  amount: number,
): number | null {
  const target = context.entities.get(targetId);
  if (!target || target.health === 0) return null;
  if (target.type === 'player') {
    const player = context.playerState(targetId);
    if (!player || player.lifecycle !== 'alive') return null;
    const before = player.health;
    context.damagePlayer(actorId, targetId, amount);
    return before - player.health;
  }
  if ((target.type !== 'creature' && target.type !== 'npc') || target.health === undefined) return null;
  const health = Math.max(0, target.health - amount);
  context.assertCanChange();
  if (health === 0) {
    context.assertCanRemoveActor(targetId, actorId);
    const drop = context.actorDeathDrop(targetId);
    const inventory = context.entities.actorComponentSnapshot(targetId).inventory;
    const stacks = inventory.flatMap((stack) => (stack ? [stack] : []));
    if (drop) stacks.push(drop);
    const prepared = prepareEntityMutation(context.entities, {
      despawns: [context.entities.createReference(targetId)!],
      spawns: stacks.map((stack) => ({ position: target.position, stack })),
    });
    prepared.validate();
    prepared.apply();
    context.cancelTarget(targetId, actorId);
    context.unregisterActor(targetId);
  } else {
    const prepared = prepareEntityMutation(context.entities, {
      actors: [
        {
          reference: context.entities.createReference(targetId)!,
          health,
          components: context.entities.actorComponentSnapshot(targetId),
        },
      ],
    });
    prepared.validate();
    prepared.apply();
    context.recordAttacked(targetId, actorId);
  }
  context.touch();
  return target.health - health;
}
