import type { AuthorityStationView } from '@seedlands/game-core/compute/authority-worker-protocol';
import type { StationRecipe } from '@seedlands/game-core/mod-api';
import type { GameplayItemPresentation, GameplayUiSource } from './gameplay-ui-projector';

export type StationUiPresentation = Readonly<{
  id: string;
  revision: number;
  kind: 'workbench' | 'chest' | 'furnace';
  name: string;
  slots: readonly GameplayItemPresentation[];
  progress: number;
  fuelSeconds: number;
  recipes: readonly Readonly<{
    id: string;
    name: string;
    pattern: readonly GameplayItemPresentation[];
    requirements: string;
    craftable: boolean;
  }>[];
}>;
export function projectStationUi(
  station: AuthorityStationView | null | undefined,
  recipes: readonly StationRecipe[],
  slots: (input: GameplayUiSource['player']['inventory'], length: number) => readonly GameplayItemPresentation[],
  name: (id: string) => string,
): StationUiPresentation | null {
  if (!station) return null;
  const state = station.component;
  const inventory =
    state.kind === 'workbench'
      ? state.grid
      : state.kind === 'chest'
        ? state.slots
        : [state.furnace.input, state.furnace.fuel, state.furnace.output];
  return {
    id: station.reference.entityId,
    revision: state.revision,
    kind: state.kind,
    name: state.kind === 'workbench' ? '工作台' : state.kind === 'chest' ? '箱子' : '熔炉',
    slots: slots(inventory, inventory.length),
    progress: state.kind === 'furnace' ? state.furnace.progressSeconds / (station.furnaceRecipeDuration ?? 1) : 0,
    fuelSeconds: state.kind === 'furnace' ? state.furnace.remainingFuelSeconds : 0,
    recipes:
      state.kind !== 'workbench'
        ? []
        : recipes.map((recipe) => ({
            id: recipe.id,
            name: recipe.outputs.map((item) => `${name(item.itemId)} × ${item.count}`).join(' + '),
            pattern: recipe.kind === 'shaped' ? slots(recipe.pattern, 9) : [],
            requirements:
              recipe.kind === 'shapeless'
                ? recipe.inputs.map((item) => `${name(item.itemId)} × ${item.count}`).join(' + ')
                : '按图放入工作台',
            craftable: station.craftableRecipeIds.includes(recipe.id),
          })),
  };
}
