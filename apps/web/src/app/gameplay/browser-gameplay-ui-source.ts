import type { AuthorityGameplayView } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import type { GameplayUiSource } from '../ui/gameplay-ui-projector';

export function browserGameplayUiSource(
  view: AuthorityGameplayView,
  local: Pick<GameplayUiSource, 'station' | 'transportStorage' | 'inventoryOpen' | 'target' | 'breaking'>,
): GameplayUiSource {
  const player = view.player;
  return {
    revision: view.gameplayRevision,
    navigation: view.navigation,
    inventoryView: view.inventory,
    player: {
      combat: player.combat,
      lifecycle: player.lifecycle,
      health: player.health,
      hunger: player.hunger,
      selectedHotbarSlot: player.selectedSlot,
      hotbarSize: player.hotbarSize,
      inventory: player.inventory,
      mode: player.mode,
      creativeCatalog: player.creativeCatalog,
      flight: player.flight,
    },
    storageInventoryRevision: view.inventory.revision,
    stationRecipes: view.stationRecipes,
    items: view.items,
    recipes: view.recipes,
    craftableRecipeIds: view.craftableRecipeIds,
    progress: view.progress,
    armorPoints: view.armorPoints,
    oxygen: { value: 20, max: 20, visible: false },
    ...local,
  };
}
