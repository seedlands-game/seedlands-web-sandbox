import { assertItemStack, getItemDefinition, type ItemId, type ItemStack } from './item-registry';

export type InventorySlot = ItemStack | null;

const cloneSlot = (slot: InventorySlot): InventorySlot => (slot ? { ...slot } : null);

export class Inventory {
  private slots: InventorySlot[];

  constructor(
    readonly capacity: number,
    initial?: readonly InventorySlot[],
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
    assertItemStack(stack);
    return (
      this.slots.reduce((count, slot) => count + (slot?.itemId === stack.itemId ? slot.count : 0), 0) >= stack.count
    );
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
    assertItemStack(stack);
    if (!this.contains(stack)) return false;
    const candidate = this.snapshot();
    let remaining = stack.count;
    for (let index = 0; index < candidate.length && remaining > 0; index += 1) {
      const slot = candidate[index];
      if (slot?.itemId !== stack.itemId) continue;
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
    const limit = getItemDefinition(source.itemId).stackLimit;
    if (target && (target.itemId !== source.itemId || target.count + count > limit)) return false;
    source.count -= count;
    candidate[targetIndex] = target ? { ...target, count: target.count + count } : { itemId: source.itemId, count };
    this.slots = candidate;
    return true;
  }

  moveStack(sourceIndex: number, targetIndex: number): boolean {
    if (!this.validIndex(sourceIndex) || !this.validIndex(targetIndex) || sourceIndex === targetIndex) return false;
    const candidate = this.snapshot();
    const source = candidate[sourceIndex];
    const target = candidate[targetIndex];
    if (!source) return false;
    if (target?.itemId === source.itemId) {
      const moved = Math.min(source.count, getItemDefinition(source.itemId).stackLimit - target.count);
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
    candidate[index] = source.count === count ? null : { ...source, count: source.count - count };
    this.slots = candidate;
    return true;
  }

  replace(snapshot: readonly InventorySlot[]): void {
    if (snapshot.length !== this.capacity) throw new TypeError('Inventory snapshot capacity does not match.');
    this.slots = snapshot.map((slot) => this.validateSlot(slot));
  }

  clear(): ItemStack[] {
    const stacks = this.slots.filter((slot): slot is ItemStack => slot !== null).map((slot) => ({ ...slot }));
    this.slots = Array.from({ length: this.capacity }, () => null);
    return stacks;
  }

  private addTo(candidate: InventorySlot[], stack: ItemStack): boolean {
    assertItemStack(stack);
    const limit = getItemDefinition(stack.itemId).stackLimit;
    let remaining = stack.count;
    for (const slot of candidate) {
      if (slot?.itemId !== stack.itemId || slot.count >= limit) continue;
      const added = Math.min(limit - slot.count, remaining);
      slot.count += added;
      remaining -= added;
      if (remaining === 0) return true;
    }
    for (let index = 0; index < candidate.length && remaining > 0; index += 1) {
      if (candidate[index]) continue;
      const added = Math.min(limit, remaining);
      candidate[index] = { itemId: stack.itemId, count: added };
      remaining -= added;
    }
    return remaining === 0;
  }

  private validateSlot(slot: InventorySlot): InventorySlot {
    if (!slot) return null;
    assertItemStack(slot);
    if (slot.count > getItemDefinition(slot.itemId).stackLimit)
      throw new TypeError(`Item stack exceeds its limit: ${slot.itemId}`);
    return { itemId: slot.itemId as ItemId, count: slot.count };
  }

  private validIndex(index: number): boolean {
    return Number.isInteger(index) && index >= 0 && index < this.capacity;
  }
}
