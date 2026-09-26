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
  const pending = [cursor.stack, ...cursor.craftingGrid].flatMap((entry) =>
    entry ? [{ ...entry, ...(entry.instance ? { instance: { ...entry.instance } } : {}) }] : [],
  );
  if (!pending.length)
    return Object.freeze({ slots: Object.freeze(inventory.map(frozenStack)), cursor, dropIntents: Object.freeze([]) });
  if (cursor.revision >= Number.MAX_SAFE_INTEGER) throw new RangeError('Inventory cursor revision exhausted.');
  const place = (stack: ItemStack, slot: number): ItemStack | null => {
    const target = inventory[slot];
    if (target && !sameItemStackIdentity(target, stack)) return stack;
    const moved = Math.min(stack.count, Math.max(0, capacity(items, target, stack)));
    if (!moved) return stack;
    inventory[slot] = { ...stack, count: (target?.count ?? 0) + moved };
    return stack.count === moved ? null : { ...stack, count: stack.count - moved };
  };
  const drops: ItemStack[] = [];
  for (const [pendingIndex, pendingStack] of pending.entries()) {
    let stack: ItemStack | null = pendingStack;
    if (
      pendingIndex === 0 &&
      cursor.stack &&
      cursor.origin?.kind === 'inventory' &&
      cursor.origin.slot < inventory.length
    )
      stack = place(stack, cursor.origin.slot);
    for (const emptyPass of [false, true])
      for (let slot = 0; slot < inventory.length && stack; slot += 1) {
        const target = inventory[slot];
        if ((emptyPass && target) || (!emptyPass && !target)) continue;
        stack = place(stack, slot);
      }
    if (stack) drops.push(stack);
  }
  return Object.freeze({
    slots: Object.freeze(inventory.map(frozenStack)),
    cursor: Object.freeze({
      version: 1,
      revision: cursor.revision + 1,
      stack: null,
      origin: null,
      craftingGrid: Object.freeze([null, null, null, null]),
    }),
    dropIntents: Object.freeze(drops.map((stack) => frozenStack(stack)!)),
  });
}
