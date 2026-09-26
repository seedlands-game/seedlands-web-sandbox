import { isArmorSlot, type InventoryPointerSlotRef } from '@seedlands/stdlib/mod-api';

/** Input intentions only. Inventory contents always come from the authority response. */
export type InventoryUiSlot = InventoryPointerSlotRef;
export type InventoryUiBulkSlot = Exclude<InventoryUiSlot, { kind: 'equipment' }>;
export type InventoryUiCommand =
  | Readonly<{ kind: 'click'; slot: InventoryUiSlot; button: 0 | 2 }>
  | Readonly<{ kind: 'distribute'; slots: readonly InventoryUiBulkSlot[]; button: 0 | 2 }>
  | Readonly<{ kind: 'quick-move'; slot: InventoryUiSlot }>
  | Readonly<{ kind: 'collect'; slot: InventoryUiBulkSlot }>
  | Readonly<{ kind: 'hotbar'; slot: InventoryUiSlot; hotbarSlot: number }>
  | Readonly<{ kind: 'craft'; batch: boolean }>
  | Readonly<{ kind: 'drop'; button: 0 | 2 }>
  | Readonly<{ kind: 'close' }>;

export const inventorySlotKey = (slot: InventoryUiSlot) => `${slot.kind}:${slot.slot}`;
export const isInventoryUiBulkSlot = (slot: InventoryUiSlot): slot is InventoryUiBulkSlot => slot.kind !== 'equipment';
export function parseInventoryUiSlotAddress(value: string | undefined): InventoryUiSlot | null {
  const parts = (value ?? '').split(':');
  if (parts.length !== 2) return null;
  const [kind, slot] = parts;
  if ((kind === 'inventory' || kind === 'crafting' || kind === 'station') && /^\d+$/.test(slot!))
    return { kind, slot: Number(slot) };
  return kind === 'equipment' && isArmorSlot(slot) ? { kind, slot } : null;
}
export const inventoryGestureContextIdentity = (
  input: Readonly<{
    inventoryOpen: boolean;
    mode: 'survival' | 'creative';
    inventoryIdentity?: string;
    stationId?: string;
  }>,
) => `${input.inventoryOpen}:${input.mode}:${input.inventoryIdentity ?? ''}:${input.stationId ?? ''}`;
type Press = { slot: InventoryUiSlot; button: 0 | 2; shift: boolean; time: number };
type Gesture = { source: InventoryUiSlot; button: 0 | 2; pickedUp: boolean; slots: InventoryUiBulkSlot[] };

export class InventoryPointerGestures {
  private queue = Promise.resolve();
  private gesture: Gesture | null = null;
  private generation = 0;
  private lastPick: { key: string; time: number } | null = null;

  constructor(
    private readonly held: () => boolean,
    private readonly send: (command: InventoryUiCommand) => Promise<boolean>,
    private readonly preview: (slots: readonly InventoryUiBulkSlot[], button: 0 | 2) => void,
  ) {}

  private enqueue(work: () => Promise<void> | void): void {
    const generation = this.generation;
    this.queue = this.queue.then(async () => {
      if (generation === this.generation) await work();
    });
  }

  begin(press: Press): void {
    this.enqueue(async () => {
      this.gesture = null;
      this.preview([], press.button);
      if (press.shift) {
        this.lastPick = null;
        if (!this.held()) await this.send({ kind: 'quick-move', slot: press.slot });
        return;
      }
      const key = inventorySlotKey(press.slot);
      if (
        press.button === 0 &&
        isInventoryUiBulkSlot(press.slot) &&
        this.held() &&
        this.lastPick?.key === key &&
        press.time - this.lastPick.time < 300
      ) {
        this.lastPick = null;
        await this.send({ kind: 'collect', slot: press.slot });
        return;
      }
      const generation = this.generation;
      const pickedUp = !this.held();
      if (pickedUp) {
        const ok = await this.send({ kind: 'click', slot: press.slot, button: press.button });
        if (!ok || !this.held() || generation !== this.generation) return;
        this.lastPick = press.button === 0 && isInventoryUiBulkSlot(press.slot) ? { key, time: press.time } : null;
      } else this.lastPick = null;
      this.gesture = {
        source: press.slot,
        button: press.button,
        pickedUp,
        slots: isInventoryUiBulkSlot(press.slot) ? [press.slot] : [],
      };
    });
  }

  enter(slot: InventoryUiSlot): void {
    this.enqueue(() => {
      const gesture = this.gesture;
      if (!gesture || gesture.pickedUp || !isInventoryUiBulkSlot(slot)) return;
      if (!gesture.slots.some((entry) => inventorySlotKey(entry) === inventorySlotKey(slot))) gesture.slots.push(slot);
      this.preview(gesture.slots, gesture.button);
    });
  }

  end(slot: InventoryUiSlot | null, outside: boolean): void {
    this.enqueue(async () => {
      const gesture = this.gesture;
      this.gesture = null;
      this.preview([], gesture?.button ?? 0);
      if (!gesture) return;
      if (outside) {
        await this.send({ kind: 'drop', button: gesture.button });
      } else if (gesture.pickedUp) {
        if (slot && inventorySlotKey(slot) !== inventorySlotKey(gesture.source))
          await this.send({ kind: 'click', slot, button: gesture.button });
      } else if (gesture.slots.length > 1) {
        await this.send({ kind: 'distribute', slots: gesture.slots, button: gesture.button });
      } else if (slot) await this.send({ kind: 'click', slot, button: gesture.button });
    });
  }

  command(command: InventoryUiCommand): void {
    this.enqueue(async () => {
      this.lastPick = null;
      await this.send(command);
    });
  }

  cancel(): void {
    this.generation += 1;
    this.gesture = null;
    this.lastPick = null;
    this.preview([], 0);
  }

  /** Wait for all captured input before closing or switching mode. */
  async settled(): Promise<void> {
    await this.queue;
  }
}
