import { Inventory, type InventorySlot } from '../inventory';
import type { ItemDefinitionRegistry } from '../item-registry';

/** A detached candidate, never a handle to a world's authoritative inventory. */
export function createInventoryCandidate(items: ItemDefinitionRegistry, value: unknown): Inventory {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64)
    throw new TypeError('Inventory candidate capacity is invalid.');
  const slots: InventorySlot[] = value.map((slot: unknown) => (slot === null ? null : items.normalizeStack(slot)));
  return new Inventory(slots.length, slots, items);
}
