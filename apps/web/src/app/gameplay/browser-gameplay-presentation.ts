import * as pc from 'playcanvas';
import type { ItemDefinition } from '@seedlands/stdlib/server/gameplay/item-registry';
import type { VoxelGeometryResolver } from '@seedlands/stdlib/world/voxel-model';
import type { SurfaceLightingSampler } from '../scene/surface-lighting';
import { FirstPersonViewmodel } from '../player/first-person-viewmodel';
import { GameplayEntityPresenter } from './gameplay-entity-presenter';

type Options = Readonly<{
  app: pc.Application;
  camera: pc.Entity;
  authority: Readonly<{ voxelGeometry?: VoxelGeometryResolver }>;
  sampleSurfaceLighting?: SurfaceLightingSampler;
}>;

/** Creates the two model owners with the same world sampler and registered geometry. */
export function createGameplayModelPresentation(options: Options, item: (id: string) => ItemDefinition | null) {
  const presenter = new GameplayEntityPresenter(
    options.app,
    item,
    options.sampleSurfaceLighting,
    options.authority.voxelGeometry,
  );
  try {
    return {
      presenter,
      viewmodel: new FirstPersonViewmodel(
        options.app,
        options.camera,
        undefined,
        options.authority.voxelGeometry,
        options.sampleSurfaceLighting,
      ),
    };
  } catch (error) {
    presenter.dispose();
    throw error;
  }
}
