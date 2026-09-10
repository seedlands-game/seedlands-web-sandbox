import { Inventory, type InventorySlot } from '../inventory';
import { sameItemStackIdentity } from '../item-instance';
import type { ItemDefinitionRegistry, ItemStack } from '../item-registry';
import { validateInventoryCursor, type InventoryCursorV1 } from './inventory-pointer-contract';

function frozenStack(stack: Readonly<ItemStack> | null): InventorySlot {
  return stack
    ? Object.freeze({
        ...stack,
        ...(stack.instance ? { instance: Object.freeze({ ...stack.instance }) } : {}),
      })
    : null;
}

function capacity(items: ItemDefinitionRegistry, target: InventorySlot, stack: ItemStack): number {
  if (target && !sameItemStackIdentity(target, stack)) return 0;
  return items.require(stack.itemId).stackLimit - (target?.count ?? 0);
}

export type SettledInventoryCursorV1 = Readonly<{
  slots: readonly InventorySlot[];
  cursor: InventoryCursorV1;
  dropIntents: readonly Readonly<ItemStack>[];
}>;

/** Settles an owned cursor without station context, used by lifecycle boundaries. */
export function settleInventoryCursor(
  items: ItemDefinitionRegistry,
  slots: readonly InventorySlot[],
  rawCursor: unknown,
): SettledInventoryCursorV1 {
  const cursor = validateInventoryCursor(rawCursor, items);
  const inventory = new Inventory(slots.length, slots, items).snapshot();
  let stack = cursor.stack
    ? { ...cursor.stack, ...(cursor.stack.instance ? { instance: { ...cursor.stack.instance } } : {}) }
    : null;
  if (!stack)
    return Object.freeze({ slots: Object.freeze(inventory.map(frozenStack)), cursor, dropIntents: Object.freeze([]) });
  if (cursor.revision >= Number.MAX_SAFE_INTEGER) throw new RangeError('Inventory cursor revision exhausted.');
  const place = (slot: number) => {
    if (!stack) return;
    const target = inventory[slot];
    if (target && !sameItemStackIdentity(target, stack)) return;
    const moved = Math.min(stack.count, Math.max(0, capacity(items, target, stack)));
    if (!moved) return;
    inventory[slot] = { ...stack, count: (target?.count ?? 0) + moved };
    stack = stack.count === moved ? null : { ...stack, count: stack.count - moved };
  };
  if (cursor.origin?.kind === 'inventory' && cursor.origin.slot < inventory.length) place(cursor.origin.slot);
  for (const emptyPass of [false, true])
    for (let slot = 0; slot < inventory.length && stack; slot += 1) {
      const target = inventory[slot];
      if ((emptyPass && target) || (!emptyPass && !target)) continue;
      place(slot);
    }
  const dropIntents = stack ? [frozenStack(stack)!] : [];
  return Object.freeze({
    slots: Object.freeze(inventory.map(frozenStack)),
    cursor: Object.freeze({ version: 1, revision: cursor.revision + 1, stack: null, origin: null }),
    dropIntents: Object.freeze(dropIntents),
  });
}
