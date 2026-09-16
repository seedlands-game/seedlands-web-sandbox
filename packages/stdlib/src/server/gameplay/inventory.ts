import { defaultItemDefinitionRegistry, type ItemDefinitionRegistry, type ItemStack } from './item-registry';
import { cloneItemStack, normalizeItemStack, sameItemStackIdentity } from './item-instance';

export type InventorySlot = ItemStack | null;

export type InventoryAccess = Pick<Inventory, keyof Inventory>;

/** Resolve on every operation so retained handles cannot mutate an entity after removal or restore. */
export const createInventoryAccess = (resolve: () => Inventory): InventoryAccess =>
  Object.freeze({
    get items() {
      return resolve().items;
    },
    get capacity() {
      return resolve().capacity;
    },
    snapshot: () => resolve().snapshot(),
    slot: (index: number) => resolve().slot(index),
    contains: (stack: ItemStack) => resolve().contains(stack),
    containsAmount: (itemId: string, count: number) => resolve().containsAmount(itemId, count),
    canAdd: (stack: ItemStack) => resolve().canAdd(stack),
    add: (stack: ItemStack) => resolve().add(stack),
    remove: (stack: ItemStack) => resolve().remove(stack),
    split: (source: number, count: number, target: number) => resolve().split(source, count, target),
    moveStack: (source: number, target: number) => resolve().moveStack(source, target),
    removeFromSlot: (index: number, count: number) => resolve().removeFromSlot(index, count),
    replace: (snapshot: readonly InventorySlot[]) => resolve().replace(snapshot),
    clear: () => resolve().clear(),
  });

const cloneSlot = (slot: InventorySlot): InventorySlot => (slot ? cloneItemStack(slot) : null);

export class Inventory {
  private slots: InventorySlot[];

  constructor(
    readonly capacity: number,
    initial?: readonly InventorySlot[],
    readonly items: ItemDefinitionRegistry = defaultItemDefinitionRegistry,
  ) {
    if (!Number.isInteger(capacity) || capacity <= 0)
      throw new TypeError('Inventory capacity must be a positive integer.');
    if (initial && initial.length !== capacity) throw new TypeError('Inventory snapshot capacity does not match.');
    this.slots = initial
      ? initial.map((slot) => this.validateSlot(slot))
      : Array.from({ length: capacity }, () => null);
  }

  snapshot(): InventorySlot[] {
    return this.slots.map(cloneSlot);
  }

  slot(index: number): InventorySlot {
    return cloneSlot(this.slots[index] ?? null);
  }

  contains(stack: ItemStack): boolean {
    const normalized = normalizeItemStack(this.items, stack);
    return (
      this.slots.reduce(
        (count, slot) => count + (slot && sameItemStackIdentity(slot, normalized) ? slot.count : 0),
        0,
      ) >= normalized.count
    );
  }

  containsAmount(itemId: string, count: number): boolean {
    this.items.require(itemId);
    if (!Number.isSafeInteger(count) || count <= 0)
      throw new TypeError('Item amount count must be a positive safe integer.');
    return this.slots.reduce((total, slot) => total + (slot?.itemId === itemId ? slot.count : 0), 0) >= count;
  }

  canAdd(stack: ItemStack): boolean {
    const candidate = this.snapshot();
    return this.addTo(candidate, stack);
  }

  add(stack: ItemStack): boolean {
    const candidate = this.snapshot();
    if (!this.addTo(candidate, stack)) return false;
    this.slots = candidate;
    return true;
  }

  remove(stack: ItemStack): boolean {
    const normalized = normalizeItemStack(this.items, stack);
    if (!this.contains(normalized)) return false;
    const candidate = this.snapshot();
    let remaining = normalized.count;
    for (let index = 0; index < candidate.length && remaining > 0; index += 1) {
      const slot = candidate[index];
      if (!slot || !sameItemStackIdentity(slot, normalized)) continue;
      const removed = Math.min(slot.count, remaining);
      slot.count -= removed;
      remaining -= removed;
      if (slot.count === 0) candidate[index] = null;
    }
    this.slots = candidate;
    return true;
  }

  split(sourceIndex: number, count: number, targetIndex: number): boolean {
    if (!this.validIndex(sourceIndex) || !this.validIndex(targetIndex) || sourceIndex === targetIndex) return false;
    if (!Number.isInteger(count) || count <= 0) return false;
    const candidate = this.snapshot();
    const source = candidate[sourceIndex];
    if (!source || source.count <= count) return false;
    const target = candidate[targetIndex];
    const limit = this.items.require(source.itemId).stackLimit;
    if (target && (!sameItemStackIdentity(target, source) || target.count + count > limit)) return false;
    source.count -= count;
    candidate[targetIndex] = target
      ? { ...cloneItemStack(target), count: target.count + count }
      : { ...cloneItemStack(source), count };
    this.slots = candidate;
    return true;
  }

  moveStack(sourceIndex: number, targetIndex: number): boolean {
    if (!this.validIndex(sourceIndex) || !this.validIndex(targetIndex) || sourceIndex === targetIndex) return false;
    const candidate = this.snapshot();
    const source = candidate[sourceIndex];
    const target = candidate[targetIndex];
    if (!source) return false;
    if (target && sameItemStackIdentity(target, source)) {
      const moved = Math.min(source.count, this.items.require(source.itemId).stackLimit - target.count);
      if (moved <= 0) return false;
      target.count += moved;
      source.count -= moved;
      if (!source.count) candidate[sourceIndex] = null;
    } else {
      candidate[targetIndex] = source;
      candidate[sourceIndex] = target;
    }
    this.slots = candidate;
    return true;
  }

  removeFromSlot(index: number, count: number): boolean {
    if (!this.validIndex(index) || !Number.isInteger(count) || count <= 0) return false;
    const source = this.slots[index];
    if (!source || source.count < count) return false;
    const candidate = this.snapshot();
    candidate[index] = source.count === count ? null : { ...cloneItemStack(source), count: source.count - count };
    this.slots = candidate;
    return true;
  }

  replace(snapshot: readonly InventorySlot[]): void {
    if (snapshot.length !== this.capacity) throw new TypeError('Inventory snapshot capacity does not match.');
    this.slots = snapshot.map((slot) => this.validateSlot(slot));
  }

  clear(): ItemStack[] {
    const stacks = this.slots.filter((slot): slot is ItemStack => slot !== null).map(cloneItemStack);
    this.slots = Array.from({ length: this.capacity }, () => null);
    return stacks;
  }

  private addTo(candidate: InventorySlot[], stack: ItemStack): boolean {
    const normalized = normalizeItemStack(this.items, stack);
    const limit = this.items.require(normalized.itemId).stackLimit;
    let remaining = normalized.count;
    for (const slot of candidate) {
      if (!slot || !sameItemStackIdentity(slot, normalized) || slot.count >= limit) continue;
      const added = Math.min(limit - slot.count, remaining);
      slot.count += added;
      remaining -= added;
      if (remaining === 0) return true;
    }
    for (let index = 0; index < candidate.length && remaining > 0; index += 1) {
      if (candidate[index]) continue;
      const added = Math.min(limit, remaining);
      candidate[index] = { ...cloneItemStack(normalized), count: added };
      remaining -= added;
    }
    return remaining === 0;
  }

  private validateSlot(slot: InventorySlot): InventorySlot {
    if (slot === null) return null;
    const normalized = normalizeItemStack(this.items, slot);
    if (normalized.count > this.items.require(normalized.itemId).stackLimit)
      throw new TypeError(`Item stack exceeds its limit: ${normalized.itemId}`);
    return normalized;
  }

  private validIndex(index: number): boolean {
    return Number.isInteger(index) && index >= 0 && index < this.capacity;
  }
}
