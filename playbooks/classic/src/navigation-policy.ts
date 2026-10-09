import { Voxel } from '@seedlands/stdlib/world/voxel';
import { freezeNavigationPolicy, type NavigationInteractionConfig } from '@seedlands/stdlib/mod-api';

export const classicNavigationConfig: NavigationInteractionConfig = Object.freeze({
  moduleId: 'seedlands:overworld-navigation',
  operationId: 'seedlands:explore-held-map',
  policy: freezeNavigationPolicy({
    version: 1,
    mapItemId: 'map',
    compassItemId: 'compass',
    clockItemId: 'clock',
    windowRadius: 4,
    sampleYOffset: -1,
    fallbackColor: 6,
    palette: [
      { voxel: Voxel.Air, color: 0 },
      { voxel: Voxel.Water, color: 1 },
      ...[Voxel.Grass, Voxel.Leaves, Voxel.Cactus].map((voxel) => ({ voxel, color: 2 })),
      ...[Voxel.Sand, Voxel.Sandstone].map((voxel) => ({ voxel, color: 3 })),
      ...[Voxel.Wood, Voxel.Planks].map((voxel) => ({ voxel, color: 4 })),
      ...[Voxel.Lava, Voxel.Fire, Voxel.Tnt].map((voxel) => ({ voxel, color: 5 })),
    ],
  }),
});
