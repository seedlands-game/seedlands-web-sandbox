import { FaceMaterial, type FaceMaterialId } from './voxel';

export type RenderCategory = 'opaque' | 'cutout' | 'emissive' | 'transparent';

export const renderCategoryForMaterial = (material: FaceMaterialId): RenderCategory =>
  material === FaceMaterial.Water
    ? 'transparent'
    : material === FaceMaterial.Leaves || material === FaceMaterial.Glass
      ? 'cutout'
      : material === FaceMaterial.LanternGlow || material === FaceMaterial.Lava
        ? 'emissive'
        : 'opaque';
