import { FaceMaterial, type FaceMaterialId } from './voxel';

export type RenderCategory = 'opaque' | 'cutout' | 'emissive' | 'transparent';

export const renderCategoryForMaterial = (material: FaceMaterialId): RenderCategory =>
  material === FaceMaterial.Water
    ? 'transparent'
    : material === FaceMaterial.Leaves
      ? 'cutout'
      : material === FaceMaterial.LanternGlow
        ? 'emissive'
        : 'opaque';
