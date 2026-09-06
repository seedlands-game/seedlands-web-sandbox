import { FaceMaterial, Voxel, isSolid, type FaceMaterialId } from './voxel';

export type LocalBox = Readonly<{
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}>;

export type VoxelModelBox = LocalBox & Readonly<{ material: FaceMaterialId }>;

const FULL_BOX: LocalBox = { min: [0, 0, 0], max: [1, 1, 1] };
const LANTERN_COLLISION: LocalBox = { min: [0.25, 0, 0.25], max: [0.75, 0.94, 0.75] };

const lanternModel: readonly VoxelModelBox[] = [
  { min: [0.22, 0, 0.22], max: [0.78, 0.12, 0.78], material: FaceMaterial.LanternFrame },
  { min: [0.24, 0.68, 0.24], max: [0.76, 0.78, 0.76], material: FaceMaterial.LanternFrame },
  { min: [0.3, 0.14, 0.3], max: [0.7, 0.68, 0.7], material: FaceMaterial.LanternGlow },
  { min: [0.22, 0.1, 0.22], max: [0.29, 0.72, 0.29], material: FaceMaterial.LanternFrame },
  { min: [0.71, 0.1, 0.22], max: [0.78, 0.72, 0.29], material: FaceMaterial.LanternFrame },
  { min: [0.22, 0.1, 0.71], max: [0.29, 0.72, 0.78], material: FaceMaterial.LanternFrame },
  { min: [0.71, 0.1, 0.71], max: [0.78, 0.72, 0.78], material: FaceMaterial.LanternFrame },
  { min: [0.34, 0.76, 0.47], max: [0.4, 0.9, 0.53], material: FaceMaterial.LanternFrame },
  { min: [0.6, 0.76, 0.47], max: [0.66, 0.9, 0.53], material: FaceMaterial.LanternFrame },
  { min: [0.34, 0.88, 0.47], max: [0.66, 0.94, 0.53], material: FaceMaterial.LanternFrame },
] as const;

export function modelBoxesForVoxel(voxel: number): readonly VoxelModelBox[] {
  return voxel === Voxel.Lantern ? lanternModel : [];
}

export function collisionBoxesForVoxel(voxel: number): readonly LocalBox[] {
  if (!isSolid(voxel)) return [];
  return voxel === Voxel.Lantern ? [LANTERN_COLLISION] : [FULL_BOX];
}

export function voxelOccludesFullFace(voxel: number): boolean {
  return isSolid(voxel) && voxel !== Voxel.Lantern;
}
