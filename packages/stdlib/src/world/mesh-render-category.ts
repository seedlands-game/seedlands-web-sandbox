import { FaceMaterial, type FaceMaterialId } from './voxel';

export type RenderCategory = 'opaque' | 'cutout' | 'emissive' | 'transparent';
const cutoutMaterials = new Set<number>([
  FaceMaterial.Leaves,
  FaceMaterial.Glass,
  FaceMaterial.Sapling,
  FaceMaterial.TallGrass,
  FaceMaterial.Flower,
  FaceMaterial.Mushroom,
  FaceMaterial.SugarCane,
]);

export const renderCategoryForMaterial = (material: FaceMaterialId): RenderCategory =>
  material === FaceMaterial.Water
    ? 'transparent'
    : cutoutMaterials.has(material)
      ? 'cutout'
      : material === FaceMaterial.LanternGlow || material === FaceMaterial.Lava || material === FaceMaterial.Fire
        ? 'emissive'
        : 'opaque';
