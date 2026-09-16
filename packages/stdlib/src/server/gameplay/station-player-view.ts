import {
  createStationCraftCandidate,
  matchesShapedStationRecipe,
  matchesShapelessStationRecipe,
} from './modules/station-candidates';
import type { AuthorityStationView } from '../protocol/authority-worker-protocol';
import type { GameplayRuntime } from './gameplay-runtime';
import type { ModuleActorAuthority } from '../composition/gameplay-actor-authority';
import { positionsInRange } from './gameplay-geometry';
import { traceVoxelRay } from './voxel-ray';

export function projectNearbyStations(
  runtime: GameplayRuntime,
  playerId: string,
  authority: ModuleActorAuthority | undefined,
  getVoxel: (x: number, y: number, z: number) => number | undefined,
): readonly AuthorityStationView[] {
  const entity = runtime.entities.get(playerId);
  if (!entity || entity.type !== 'player' || !runtime.content.stations) return [];
  const actor = runtime.entities.actorStateAccess(playerId);
  const binding = authority?.forActor(playerId, 'player');
  if (!binding || actor.lifecycle !== 'alive') return [];
  const eye: [number, number, number] = [entity.position[0], entity.position[1] + 1.6, entity.position[2]];
  return runtime.entities.queryStations().flatMap((station) => {
    const component = runtime.entities.stationSnapshot(station.id)!;
    const center: [number, number, number] = station.position.map((value) => value + 0.5) as [number, number, number];
    if (!positionsInRange(eye, center, 4.5) || getVoxel(...station.position) !== component.voxel) return [];
    if (
      !binding.authorizer.authorize(binding.principalId, {
        resource: 'seedlands.station',
        operation: 'read',
        target: { kind: 'entity', entityId: station.id },
      }).allowed ||
      traceVoxelRay(eye, center, getVoxel) !== 'clear'
    )
      return [];
    const matchedRecipes =
      component.kind === 'workbench'
        ? runtime.content
            .stations!.listRecipes()
            .filter((recipe) =>
              recipe.kind === 'shaped'
                ? matchesShapedStationRecipe(component.grid, recipe, runtime.content.items)
                : matchesShapelessStationRecipe(component.grid, recipe, runtime.content.items),
            )
        : [];
    return [
      {
        reference: runtime.entities.createReference(station.id)!,
        position: station.position,
        component,
        matchedRecipeIds: matchedRecipes.map((recipe) => recipe.id),
        craftableRecipeIds: matchedRecipes
          .filter(
            (recipe) =>
              createStationCraftCandidate({
                grid: component.kind === 'workbench' ? component.grid : [],
                output: actor.inventory.snapshot(),
                recipe,
                items: runtime.content.items,
              }).success,
          )
          .map((recipe) => recipe.id),
        acceptedItemIdsBySlot:
          component.kind === 'furnace'
            ? [
                runtime.content.stations!.codec.furnace.listRecipes().map((recipe) => recipe.input.itemId),
                runtime.content.stations!.codec.furnace.listFuels().map((fuel) => fuel.itemId),
                [],
              ]
            : Array.from(
                { length: component.kind === 'workbench' ? component.grid.length : component.slots.length },
                () => null,
              ),
        ...(component.kind === 'furnace'
          ? {
              furnaceRecipeDuration: runtime.content.stations!.codec.furnace.recipe(
                component.furnace.activeRecipeId ?? '',
              )?.durationSeconds,
            }
          : {}),
      },
    ];
  });
}
