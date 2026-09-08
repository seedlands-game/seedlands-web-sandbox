import type * as pc from 'playcanvas';
import { loadAppearanceProjectSnapshot } from '../../client/persistence/appearance-project-store';
import { setAppearanceResources, getAppearanceResources } from './appearance-runtime';
import { setAppearanceImages } from './asset-image';
import { createVoxelMaterials } from '../scene/voxel-materials';
import type { QualityProfile } from '../scene/quality-profile';

export async function loadAppearanceRuntime(app: pc.Application) {
  const { state, models } = await loadAppearanceProjectSnapshot();
  const project = structuredClone(state.applied);
  const usedModelIds = new Set(Object.values(project.animationBindings ?? {}).map((binding) => binding.modelId));
  setAppearanceResources(
    app,
    project,
    new Map(models.filter((model) => usedModelIds.has(model.id)).map((model) => [model.id, model.blob])),
  );
  setAppearanceImages(project);
  return getAppearanceResources(app)!;
}

export async function createAppearanceMaterials(app: pc.Application, quality: QualityProfile) {
  const assets = await loadAppearanceRuntime(app);
  return createVoxelMaterials(
    app,
    quality,
    assets.filter((asset) => asset.type === 'pixel-texture'),
    assets,
  );
}
