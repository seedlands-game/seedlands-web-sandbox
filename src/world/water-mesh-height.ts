import { FaceMaterial, Voxel, type FaceMaterialId } from './voxel';

export const waterSurfaceHeight = (fluidLevel: number, coveredByWater: boolean): number => {
  if (coveredByWater) return 1;
  const level = Math.max(1, Math.min(8, fluidLevel));
  return level === 8 ? 7 / 8 : level / 8;
};

export function waterStepFace(
  axis: number,
  a: number,
  b: number,
  aHeight: number,
  bHeight: number,
): { forward: boolean; back: boolean; high: number; low: number } | null {
  if (axis === 1 || a !== Voxel.Water || b !== Voxel.Water) return null;
  if (aHeight === bHeight) return null;
  return {
    forward: aHeight > bHeight,
    back: bHeight > aHeight,
    high: Math.max(aHeight, bHeight),
    low: Math.min(aHeight, bHeight),
  };
}

export function shapeWaterFace(
  material: FaceMaterialId,
  normalAxis: number,
  back: boolean,
  surfaceHeight: number,
  floorHeight: number,
  vertices: number[],
): void {
  if (material !== FaceMaterial.Water || (normalAxis === 1 && back)) return;
  const top = Math.max(vertices[1], vertices[4], vertices[7], vertices[10]);
  const bottom = Math.min(vertices[1], vertices[4], vertices[7], vertices[10]);
  for (let index = 1; index < vertices.length; index += 3) {
    if (vertices[index] === top) vertices[index] = top + surfaceHeight - 1;
    else if (normalAxis !== 1 && vertices[index] === bottom) vertices[index] = bottom + floorHeight;
  }
}
