import type { ArmorEquipment } from './ecs-actor-armor-state';
import { isActorEntityType } from './ecs-actor-state';
import type { EntityStore } from './entity-store';
import type { ItemStack } from './item-registry';
import { prepareEntityMutation } from './prepared-entity-mutation';
import { emptyInventoryCursor } from './modules/inventory-pointer-contract';
import {
  buildDeathInventorySettlementCandidateV1,
  prepareDeathInventorySettlementSeriesV1,
} from './death-inventory-settlement';
import type { DeathInventoryPolicyCapabilityV1 } from './modules/death-inventory-policy-module';

type CombatDeathInventoryMode =
  Readonly<{ kind: 'legacy' }> | Readonly<{ kind: 'composed'; capability: DeathInventoryPolicyCapabilityV1 | null }>;

/** Policy already selected the amount; this owner only prepares health, inventory and drops. */
export function prepareCombatDamage(
  options: Readonly<{
    entities: EntityStore;
    targetId: string;
    damage: number;
    armor?: ArmorEquipment;
    deathInventory: CombatDeathInventoryMode;
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
  const armored = options.armor
    ? { ...components, equipment: { ...components.equipment, armor: options.armor } }
    : components;
  if (health > 0) {
    const entity = prepareEntityMutation(options.entities, {
      actors: [{ reference, health, components: armored }],
    });
    return { damage, entity, deaths, removals };
  }
  if (options.deathInventory.kind === 'composed') {
    const capability = options.deathInventory.capability;
    if (!capability) throw new Error('death-inventory-policy-unavailable');
    const settlementComponents =
      target.type === 'player' ? { ...armored, player: { ...armored.player!, breakAction: null } } : armored;
    const candidate = buildDeathInventorySettlementCandidateV1({
      source: { actorReference: reference, health: target.health, components },
      position: target.position,
      settlementComponents,
      policy: capability.policyFor(target.type),
    });
    const intrinsic = target.type === 'player' ? null : options.actorDeathDrop(target.id);
    return {
      damage,
      entity: prepareDeathInventorySettlementSeriesV1(options.entities, {
        candidates: [candidate],
        ...(intrinsic ? { intrinsicDrops: [{ position: target.position, stack: intrinsic }] } : {}),
      }),
      deaths,
      removals: candidate.despawnReference ? [target.id] : [],
    };
  }
  const cursorStack = components.inventoryCursor?.stack;
  const interactionItems = [cursorStack, ...(components.inventoryCursor?.craftingGrid ?? [])];
  const stacks = [...components.inventory, ...interactionItems].flatMap((stack) => (stack ? [stack] : []));
  if (removals.length) {
    const drop = options.actorDeathDrop(target.id);
    if (drop) stacks.push(drop);
  }
  const next =
    target.type === 'player'
      ? {
          ...armored,
          lifecycle: 'dead' as const,
          inventory: armored.inventory.map(() => null),
          inventoryCursor: interactionItems.some(Boolean)
            ? { ...emptyInventoryCursor(), revision: (armored.inventoryCursor?.revision ?? 0) + 1 }
            : armored.inventoryCursor,
          player: { ...armored.player!, breakAction: null },
        }
      : armored;
  const entity = prepareEntityMutation(options.entities, {
    ...(removals.length ? { despawns: [reference] } : { actors: [{ reference, health, components: next }] }),
    spawns: stacks.map((stack) => ({ position: target.position, stack })),
  });
  return { damage, entity, deaths, removals };
}
