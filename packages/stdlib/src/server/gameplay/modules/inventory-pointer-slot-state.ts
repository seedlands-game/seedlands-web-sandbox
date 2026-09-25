import type { StationComponentV1 } from '../ecs-station-state';
import type { InventorySlot } from '../inventory';
import type { ItemDefinitionRegistry, ItemStack } from '../item-registry';
import { ARMOR_SLOTS, type ArmorSlot } from './armor-policy';
import type {
  InventoryCursorOriginV1,
  InventoryPointerActorProjectionV1,
  InventoryEquipmentProjectionV1,
  InventoryPointerSlotRef,
  InventoryPointerStationProjectionV1,
} from './inventory-pointer-contract';

export type MutableInventoryPointerState = {
  slots: InventorySlot[];
  craftingSlots: InventorySlot[];
  cursorStack: InventorySlot;
  cursorOrigin: InventoryCursorOriginV1 | null;
  equipment: {
    selectedSlot: number;
    hotbarSize: number;
    armor: Record<ArmorSlot, InventorySlot>;
  };
  station: StationComponentV1 | null;
  stationSlots: InventorySlot[] | null;
  drops: ItemStack[];
  crafted: number;
};

const copiedStack = (stack: Readonly<ItemStack> | null): InventorySlot =>
  stack ? { ...stack, ...(stack.instance ? { instance: { ...stack.instance } } : {}) } : null;
const frozenStack = (stack: Readonly<ItemStack> | null): InventorySlot =>
  stack
    ? Object.freeze({ ...stack, ...(stack.instance ? { instance: Object.freeze({ ...stack.instance }) } : {}) })
    : null;

export function mutableInventoryPointerEquipment(
  source: InventoryPointerActorProjectionV1['equipment'],
): MutableInventoryPointerState['equipment'] {
  const armor = Object.fromEntries(
    ARMOR_SLOTS.map((slot) => {
      const stack = source.armor[slot];
      if (stack && stack.count !== 1) throw new Error('invalid-pointer-slot');
      return [slot, copiedStack(stack)];
    }),
  ) as Record<ArmorSlot, InventorySlot>;
  return { selectedSlot: source.selectedSlot, hotbarSize: source.hotbarSize, armor };
}

export function frozenInventoryPointerEquipment(
  source: MutableInventoryPointerState['equipment'],
): InventoryEquipmentProjectionV1 {
  const armor = Object.fromEntries(ARMOR_SLOTS.map((slot) => [slot, frozenStack(source.armor[slot])])) as Record<
    ArmorSlot,
    InventorySlot
  >;
  return Object.freeze({
    selectedSlot: source.selectedSlot,
    hotbarSize: source.hotbarSize,
    armor: Object.freeze(armor),
  });
}

export function inventoryPointerQuickMoveDestinations(
  items: ItemDefinitionRegistry,
  actor: InventoryPointerActorProjectionV1,
  state: MutableInventoryPointerState,
  source: InventoryPointerSlotRef,
  sourceStack: ItemStack,
): InventoryPointerSlotRef[] {
  if (state.station) {
    if (source.kind === 'station' || source.kind === 'equipment')
      return actor.slots.map((_, slot) => ({ kind: 'inventory' as const, slot }));
    return state.stationSlots!.map((_, slot) => ({ kind: 'station' as const, slot }));
  }
  if (source.kind === 'crafting') return actor.slots.map((_, slot) => ({ kind: 'inventory' as const, slot }));
  if (source.kind === 'equipment') return actor.slots.map((_, slot) => ({ kind: 'inventory' as const, slot }));
  const start = source.slot < actor.equipment.hotbarSize ? actor.equipment.hotbarSize : 0;
  const end = source.slot < actor.equipment.hotbarSize ? actor.slots.length : actor.equipment.hotbarSize;
  const inventory = Array.from({ length: end - start }, (_, offset) => ({
    kind: 'inventory' as const,
    slot: start + offset,
  }));
  const armor = items.capability(sourceStack.itemId, 'armor');
  return armor && !state.equipment.armor[armor.slot]
    ? [{ kind: 'equipment', slot: armor.slot }, ...inventory]
    : inventory;
}

export function readInventoryPointerSlot(
  state: MutableInventoryPointerState,
  ref: InventoryPointerSlotRef,
): InventorySlot {
  if (ref.kind === 'equipment') return state.equipment.armor[ref.slot];
  const values =
    ref.kind === 'inventory' ? state.slots : ref.kind === 'crafting' ? state.craftingSlots : state.stationSlots;
  if (!values || ref.slot >= values.length) throw new Error('invalid-pointer-slot');
  return values[ref.slot] ?? null;
}

export function writeInventoryPointerSlot(
  state: MutableInventoryPointerState,
  ref: InventoryPointerSlotRef,
  value: InventorySlot,
): void {
  if (ref.kind === 'equipment') {
    if (value && value.count !== 1) throw new Error('invalid-pointer-slot');
    state.equipment.armor[ref.slot] = copiedStack(value);
    return;
  }
  const values =
    ref.kind === 'inventory' ? state.slots : ref.kind === 'crafting' ? state.craftingSlots : state.stationSlots;
  if (!values || ref.slot >= values.length) throw new Error('invalid-pointer-slot');
  values[ref.slot] = copiedStack(value);
}

export function inventoryPointerOrigin(
  ref: InventoryPointerSlotRef,
  station: InventoryPointerStationProjectionV1 | undefined,
): InventoryCursorOriginV1 {
  if (ref.kind === 'station')
    return Object.freeze({ kind: 'station', reference: Object.freeze({ ...station!.reference }), slot: ref.slot });
  if (ref.kind === 'equipment') return Object.freeze({ kind: 'equipment', slot: ref.slot });
  return Object.freeze({ kind: ref.kind, slot: ref.slot });
}
