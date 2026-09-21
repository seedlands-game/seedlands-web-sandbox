import type { ActorComponentAccess } from './ecs-actor-components';
import type { ItemDefinitionRegistry } from './item-registry';
import { ARMOR_SLOTS, armorDamageReduction, type ArmorSlot } from './modules/armor-policy';

export const armorPoints = (actor: ActorComponentAccess, items: ItemDefinitionRegistry) =>
  ARMOR_SLOTS.reduce((total, slot) => {
    const stack = actor.armor[slot];
    return total + (stack ? (items.capability(stack.itemId, 'armor')?.points ?? 0) : 0);
  }, 0);

export function equipSelectedArmor(actor: ActorComponentAccess, items: ItemDefinitionRegistry) {
  const selected = actor.inventory.slot(actor.selectedSlot);
  if (!selected) return { success: false as const, reason: 'empty-slot' };
  const capability = items.capability(selected.itemId, 'armor');
  if (!capability) return { success: false as const, reason: 'not-armor' };
  const inventory = actor.inventory.snapshot();
  const equipped = actor.armor[capability.slot];
  inventory[actor.selectedSlot] = equipped;
  actor.inventory.replace(inventory);
  actor.replaceArmor({ ...actor.armor, [capability.slot]: selected });
  return { success: true as const, slot: capability.slot, equipped: selected, replaced: equipped };
}

export function prepareArmorDamage(actor: ActorComponentAccess, items: ItemDefinitionRegistry, incoming: number) {
  const damage = armorDamageReduction(incoming, armorPoints(actor, items));
  const armor = { ...actor.armor };
  for (const slot of ARMOR_SLOTS) {
    const stack = armor[slot];
    if (!stack?.instance) continue;
    armor[slot] =
      stack.instance.durability === 1 ? null : { ...stack, instance: { durability: stack.instance.durability - 1 } };
  }
  return { damage, armor: armor as Record<ArmorSlot, (typeof armor)[ArmorSlot]> };
}
