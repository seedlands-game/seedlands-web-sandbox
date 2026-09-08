import type * as pc from 'playcanvas';
import { loadAppearanceProject } from '../../client/persistence/appearance-project-store';
import { setAppearanceResources, getAppearanceResources } from './appearance-runtime';
import { setAppearanceImages } from './asset-image';
import { createVoxelMaterials } from '../scene/voxel-materials';
import type { QualityProfile } from '../scene/quality-profile';

export async function loadAppearanceRuntime(app: pc.Application) {
  const state = await loadAppearanceProject();
  const project = structuredClone(state.applied);
  setAppearanceResources(app, project);
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
