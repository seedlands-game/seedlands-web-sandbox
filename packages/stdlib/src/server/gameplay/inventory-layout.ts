export type PlayerInventoryLayout = Readonly<{ capacity: number; hotbarSize: number }>;
export const DEFAULT_PLAYER_INVENTORY_LAYOUT: PlayerInventoryLayout = Object.freeze({ capacity: 24, hotbarSize: 8 });
export const PLAYER_INVENTORY_LAYOUT_CAPABILITY = 'seedlands:player-inventory-layout';

export function freezePlayerInventoryLayout(
  layout: PlayerInventoryLayout = DEFAULT_PLAYER_INVENTORY_LAYOUT,
): PlayerInventoryLayout {
  if (
    !layout ||
    !Number.isSafeInteger(layout.capacity) ||
    layout.capacity < 1 ||
    layout.capacity > 64 ||
    !Number.isSafeInteger(layout.hotbarSize) ||
    layout.hotbarSize < 1 ||
    layout.hotbarSize > Math.min(9, layout.capacity)
  )
    throw new TypeError('Player inventory layout is invalid.');
  return Object.freeze({ capacity: layout.capacity, hotbarSize: layout.hotbarSize });
}

export function validateSavedInventoryLayout(
  inventory: unknown,
  hotbarSize: number,
  player: boolean,
  layout: PlayerInventoryLayout,
): void {
  if (!Array.isArray(inventory)) throw new TypeError('Actor inventory snapshot is invalid.');
  const legacy = inventory.length === 24 && hotbarSize === 8;
  const selected = player && inventory.length === layout.capacity && hotbarSize === layout.hotbarSize;
  if (!legacy && !selected) throw new TypeError('Actor inventory snapshot is invalid.');
}

export function validateSavedEquipment(
  equipment: { hotbarSize: number; selectedSlot: number },
  player: boolean,
  playerLayout: PlayerInventoryLayout,
): void {
  if (
    !equipment ||
    !Number.isSafeInteger(equipment.hotbarSize) ||
    equipment.hotbarSize <= 0 ||
    (equipment.hotbarSize !== 8 && (!player || equipment.hotbarSize !== playerLayout.hotbarSize)) ||
    !Number.isSafeInteger(equipment.selectedSlot) ||
    equipment.selectedSlot < 0 ||
    equipment.selectedSlot >= equipment.hotbarSize
  )
    throw new TypeError('Actor equipment snapshot is invalid.');
}
