import type { AuthorityGameplayView } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';

export function canTargetFluidSource(view: AuthorityGameplayView): boolean {
  const player = view.player;
  const selectedItemId =
    player.mode?.value === 'creative'
      ? (player.creativeCatalog?.hotbar[player.creativeCatalog.selectedSlot] ?? null)
      : (player.inventory[player.selectedSlot]?.itemId ?? null);
  if (!selectedItemId) return false;
  return Boolean(
    view.items
      ?.find(({ id }) => id === selectedItemId)
      ?.capabilities.some((capability) => capability.type === 'fluid-container' && capability.fluid === 'empty'),
  );
}

export function canTargetFluidSurface(view: AuthorityGameplayView): boolean {
  const player = view.player;
  const itemId =
    player.mode?.value === 'creative'
      ? (player.creativeCatalog?.hotbar[player.creativeCatalog.selectedSlot] ?? null)
      : (player.inventory[player.selectedSlot]?.itemId ?? null);
  return Boolean(
    itemId && view.fluidTargetItems?.some((entry) => entry.itemId === itemId && entry.policy === 'fluid-surface'),
  );
}
