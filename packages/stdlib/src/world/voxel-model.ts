import { FaceMaterial, Voxel, isSolid, type FaceMaterialId } from './voxel';
import type { VoxelGeometryRegistryV1 } from './voxel-geometry';

export type LocalBox = Readonly<{
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}>;

export type VoxelModelBox = LocalBox & Readonly<{ material: FaceMaterialId }>;
export type VoxelGeometryResolver = Pick<VoxelGeometryRegistryV1, 'get'>;

const FULL_BOX: LocalBox = { min: [0, 0, 0], max: [1, 1, 1] };
const LANTERN_COLLISION: LocalBox = { min: [0.25, 0, 0.25], max: [0.75, 0.94, 0.75] };
const FENCE_COLLISION: LocalBox = { min: [0.38, 0, 0.38], max: [0.62, 1, 0.62] };
const box = (min: LocalBox['min'], max: LocalBox['max'], material: FaceMaterialId): VoxelModelBox => ({
  min,
  max,
  material,
});
const crossedPlantMaterials = new Map<number, FaceMaterialId>([
  [Voxel.Sapling, FaceMaterial.Sapling],
  [Voxel.TallGrass, FaceMaterial.TallGrass],
  [Voxel.Flower, FaceMaterial.Flower],
  [Voxel.Mushroom, FaceMaterial.Mushroom],
  [Voxel.SugarCane, FaceMaterial.SugarCane],
  [Voxel.DeadBush, FaceMaterial.DeadBush],
  [Voxel.RedFlower, FaceMaterial.RedFlower],
  [Voxel.RedMushroom, FaceMaterial.RedMushroom],
]);
const models = new Map<number, readonly VoxelModelBox[]>([
  [Voxel.Rail, [box([0, 0, 0], [1, 0.08, 1], FaceMaterial.Rail)]],
  [Voxel.PoweredRail, [box([0, 0, 0], [1, 0.08, 1], FaceMaterial.PoweredRail)]],
  [Voxel.DetectorRail, [box([0, 0, 0], [1, 0.08, 1], FaceMaterial.DetectorRail)]],
  [Voxel.Slab, [box([0, 0, 0], [1, 0.5, 1], FaceMaterial.Slab)]],
  [
    Voxel.WoodStairs,
    [box([0, 0, 0], [1, 0.5, 1], FaceMaterial.WoodStairs), box([0, 0.5, 0.5], [1, 1, 1], FaceMaterial.WoodStairs)],
  ],
  [
    Voxel.CobblestoneStairs,
    [
      box([0, 0, 0], [1, 0.5, 1], FaceMaterial.CobblestoneStairs),
      box([0, 0.5, 0.5], [1, 1, 1], FaceMaterial.CobblestoneStairs),
    ],
  ],
  [Voxel.WoodenDoor, [box([0, 0, 0.44], [1, 1, 0.56], FaceMaterial.WoodenDoor)]],
  [Voxel.Ladder, [box([0, 0, 0.88], [1, 1, 1], FaceMaterial.Ladder)]],
  [
    Voxel.Torch,
    [
      box([0.43, 0, 0.43], [0.57, 0.56, 0.57], FaceMaterial.Torch),
      box([0.36, 0.56, 0.36], [0.64, 0.82, 0.64], FaceMaterial.TorchFlame),
    ],
  ],
  [Voxel.Bed, [box([0, 0, 0], [1, 0.56, 1], FaceMaterial.Bed)]],
  [
    Voxel.Sign,
    [
      box([0.08, 0.48, 0.45], [0.92, 0.95, 0.55], FaceMaterial.Sign),
      box([0.46, 0, 0.46], [0.54, 0.5, 0.54], FaceMaterial.Sign),
    ],
  ],
  [
    Voxel.Fence,
    [
      box(FENCE_COLLISION.min, FENCE_COLLISION.max, FaceMaterial.Fence),
      box([0, 0.38, 0.44], [1, 0.5, 0.56], FaceMaterial.Fence),
      box([0, 0.68, 0.44], [1, 0.8, 0.56], FaceMaterial.Fence),
      box([0.44, 0.38, 0], [0.56, 0.5, 1], FaceMaterial.Fence),
      box([0.44, 0.68, 0], [0.56, 0.8, 1], FaceMaterial.Fence),
    ],
  ],
  [Voxel.Cake, [box([0.06, 0, 0.06], [0.94, 0.5, 0.94], FaceMaterial.Cake)]],
]);

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

export function modelBoxesForVoxel(voxel: number, geometry?: VoxelGeometryResolver): readonly VoxelModelBox[] {
  const registered = geometry?.get(voxel);
  if (registered) return registered.boxes;
  return voxel === Voxel.Lantern ? lanternModel : (models.get(voxel) ?? []);
}

/**
 * Classic foliage is rendered as crossed cutout planes rather than a collision box or a full cube.
 * The material remains authoritative here so world, item, and Wasm descriptor consumers share IDs.
 */
export function crossedPlantMaterialForVoxel(voxel: number): FaceMaterialId | undefined {
  return crossedPlantMaterials.get(voxel);
}

export function hasVoxelModelGeometry(voxel: number): boolean {
  return modelBoxesForVoxel(voxel).length > 0 || crossedPlantMaterialForVoxel(voxel) !== undefined;
}

export function collisionBoxesForVoxel(voxel: number, geometry?: VoxelGeometryResolver): readonly LocalBox[] {
  const registered = geometry?.get(voxel);
  if (registered) return registered.collision;
  if (!isSolid(voxel)) return [];
  if (voxel === Voxel.Ladder || voxel === Voxel.Torch || voxel === Voxel.Sign) return [];
  if (voxel === Voxel.Fence) return [FENCE_COLLISION];
  return voxel === Voxel.Lantern
    ? [LANTERN_COLLISION]
    : (models.get(voxel)?.map(({ min, max }) => ({ min, max })) ?? [FULL_BOX]);
}

export function voxelOccludesFullFace(voxel: number, geometry?: VoxelGeometryResolver): boolean {
  const registered = geometry?.get(voxel);
  return registered
    ? registered.occludesFullFace
    : isSolid(voxel) && voxel !== Voxel.Glass && voxel !== Voxel.Ice && !hasVoxelModelGeometry(voxel);
}
