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
  FaceMaterial.DeadBush,
  FaceMaterial.RedFlower,
  FaceMaterial.RedMushroom,
  FaceMaterial.Fire,
  FaceMaterial.Rail,
  FaceMaterial.PoweredRail,
  FaceMaterial.DetectorRail,
]);

export const renderCategoryForMaterial = (material: FaceMaterialId): RenderCategory =>
  material === FaceMaterial.Water || material === FaceMaterial.Ice
    ? 'transparent'
    : cutoutMaterials.has(material)
      ? 'cutout'
      : material === FaceMaterial.LanternGlow || material === FaceMaterial.Lava
        ? 'emissive'
        : 'opaque';
