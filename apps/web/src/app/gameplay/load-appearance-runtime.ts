import type * as pc from 'playcanvas';
import { loadAppearanceProjectSnapshot } from '../../client/persistence/appearance-project-store';
import { setAppearanceResources, getAppearanceResources, setPackPresentationResources } from './appearance-runtime';
import { setAppearanceImages, setPackPresentationCatalog } from './asset-image';
import { createVoxelMaterials } from '../scene/voxel-materials';
import type { QualityProfile } from '../scene/quality-profile';
import { loadBrowserPackPresentationCatalog } from '../../client/presentation/pack-presentation-loader';
import { createPlayCanvasCropPresentation } from '../world/playcanvas-crop-stage-adapter';

export async function loadAppearanceRuntime(app: pc.Application) {
  const [{ state, models }, presentation] = await Promise.all([
    loadAppearanceProjectSnapshot(),
    loadBrowserPackPresentationCatalog(new URL(`${import.meta.env.BASE_URL}packs/`, location.origin)),
  ]);
  const project = structuredClone(state.applied);
  const usedModelIds = new Set(Object.values(project.animationBindings ?? {}).map((binding) => binding.modelId));
  setAppearanceResources(
    app,
    project,
    new Map(models.filter((model) => usedModelIds.has(model.id)).map((model) => [model.id, model.blob])),
  );
  setPackPresentationCatalog(presentation);
  setPackPresentationResources(app, presentation);
  setAppearanceImages(project);
  return { assets: getAppearanceResources(app)!, presentation };
}

export async function createAppearanceMaterials(app: pc.Application, quality: QualityProfile) {
  const { assets, presentation } = await loadAppearanceRuntime(app);
  const materials = await createVoxelMaterials(
    app,
    quality,
    assets.filter((asset) => asset.type === 'pixel-texture'),
    assets,
    presentation,
  );
  try {
    const crops = await createPlayCanvasCropPresentation(app, presentation);
    return {
      ...materials,
      crops,
      cropLightingMaterials: crops.lightingMaterials,
      updateAuxiliaryLightingFrame: crops.setLightingFrame,
      destroy() {
        crops.dispose();
        materials.destroy();
      },
    };
  } catch (error) {
    materials.destroy();
    throw error;
  }
}
