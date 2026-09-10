import { isActorEntityType } from './ecs-actor-state';
import type { EntityStore } from './entity-store';
import type { ItemStack } from './item-registry';
import { prepareEntityMutation } from './prepared-entity-mutation';
import { emptyInventoryCursor } from './modules/inventory-pointer-contract';

/** Policy already selected the amount; this owner only prepares health, inventory and drops. */
export function prepareCombatDamage(
  options: Readonly<{
    entities: EntityStore;
    targetId: string;
    damage: number;
    actorDeathDrop(id: string): ItemStack | null;
  }>,
) {
  if (!Number.isFinite(options.damage) || options.damage < 0)
    throw new TypeError('Combat damage must be finite and non-negative.');
  const target = options.entities.get(options.targetId);
  const reference = options.entities.createReference(options.targetId);
  if (!target || !reference || !isActorEntityType(target.type) || target.health === undefined || target.health <= 0)
    throw new Error('Combat target is unavailable.');
  const health = Math.max(0, target.health - options.damage);
  const damage = target.health - health;
  if (damage === 0) return { damage, entity: null, deaths: [], removals: [] };
  const components = options.entities.actorComponentSnapshot(target.id);
  const deaths = health === 0 ? [target.id] : [];
  const removals = health === 0 && target.type !== 'player' ? [target.id] : [];
  const cursorStack = components.inventoryCursor?.stack;
  const stacks = health === 0 ? [...components.inventory, cursorStack].flatMap((stack) => (stack ? [stack] : [])) : [];
  if (removals.length) {
    const drop = options.actorDeathDrop(target.id);
    if (drop) stacks.push(drop);
  }
  const next =
    health === 0 && target.type === 'player'
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
  const entity = prepareEntityMutation(options.entities, {
    ...(removals.length ? { despawns: [reference] } : { actors: [{ reference, health, components: next }] }),
    spawns: stacks.map((stack) => ({ position: target.position, stack })),
  });
  return { damage, entity, deaths, removals };
}
