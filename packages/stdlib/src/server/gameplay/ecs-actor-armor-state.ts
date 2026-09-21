import type { InventorySlot } from './inventory';
import type { ItemDefinitionRegistry } from './item-registry';
import { ARMOR_SLOTS, type ArmorSlot } from './modules/armor-policy';
import type { createActorComponents } from './ecs-actor-components';

type Components = ReturnType<typeof createActorComponents>;
export type ArmorEquipment = Readonly<Record<ArmorSlot, InventorySlot>>;
export const emptyArmorEquipment = (): Record<ArmorSlot, InventorySlot> => ({
  helmet: null,
  chestplate: null,
  leggings: null,
  boots: null,
});
export const normalizeArmorEquipment = (items: ItemDefinitionRegistry, value?: ArmorEquipment) =>
  Object.fromEntries(
    ARMOR_SLOTS.map((slot) => {
      const stack = value?.[slot] ?? null;
      if (!stack) return [slot, null];
      const normalized = items.normalizeStack(stack);
      if (items.capability(normalized.itemId, 'armor')?.slot !== slot)
        throw new TypeError('Actor armor slot is invalid.');
      return [slot, normalized];
    }),
  ) as Record<ArmorSlot, InventorySlot>;
export const readActorArmor = (components: Components, eid: number): ArmorEquipment =>
  Object.freeze({ ...components.equipment.armor[eid]! });
export const writeActorArmor = (
  components: Components,
  eid: number,
  items: ItemDefinitionRegistry,
  value?: ArmorEquipment,
) => {
  components.equipment.armor[eid] = normalizeArmorEquipment(items, value);
};
