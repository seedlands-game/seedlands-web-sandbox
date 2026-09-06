import { waterSurfaceHeight } from './water-mesh-height';
import { Voxel } from './voxel';

export type WaterImmersionSnapshot = {
  bodyFraction: number;
  wading: boolean;
  swimming: boolean;
  cameraSubmerged: boolean;
  cameraDepth: number;
  waterSurfaceY: number | null;
};

export const DRY_WATER_IMMERSION: WaterImmersionSnapshot = Object.freeze({
  bodyFraction: 0,
  wading: false,
  swimming: false,
  cameraSubmerged: false,
  cameraDepth: Number.NEGATIVE_INFINITY,
  waterSurfaceY: null,
});

export type WaterImmersionInput = {
  cameraPosition: readonly [number, number, number];
  bodyBounds: Readonly<{
    min: readonly [number, number, number];
    max: readonly [number, number, number];
  }>;
  previousCameraSubmerged: boolean;
  getVoxel: (x: number, y: number, z: number) => number;
  getFluidLevel: (x: number, y: number, z: number) => number | null;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const CAMERA_ENTER_DEPTH = 0.08;
const CAMERA_EXIT_CLEARANCE = 0.06;
const WADING_FRACTION = 0.04;
const SWIMMING_FRACTION = 0.58;

export function sampleWaterImmersion(input: WaterImmersionInput): WaterImmersionSnapshot {
  const [cameraX, cameraY, cameraZ] = input.cameraPosition;
  const { min, max } = input.bodyBounds;
  const bodyVolume = Math.max(0.001, (max[0] - min[0]) * (max[1] - min[1]) * (max[2] - min[2]));
  const xFrom = Math.floor(min[0]);
  const xTo = Math.ceil(max[0]) - 1;
  const yFrom = Math.floor(min[1]);
  const yTo = Math.ceil(max[1]) - 1;
  const zFrom = Math.floor(min[2]);
  const zTo = Math.ceil(max[2]) - 1;
  const cameraVoxelX = Math.floor(cameraX);
  const cameraVoxelZ = Math.floor(cameraZ);
  let immersedVolume = 0;
  let waterSurfaceY: number | null = null;
  for (let x = xFrom; x <= xTo; x += 1)
    for (let y = yFrom; y <= yTo; y += 1)
      for (let z = zFrom; z <= zTo; z += 1) {
        if (input.getVoxel(x, y, z) !== Voxel.Water) continue;
        const level = input.getFluidLevel(x, y, z) ?? 8;
        const covered = input.getVoxel(x, y + 1, z) === Voxel.Water;
        const surfaceY = y + waterSurfaceHeight(level, covered);
        const width = Math.max(0, Math.min(max[0], x + 1) - Math.max(min[0], x));
        const height = Math.max(0, Math.min(max[1], surfaceY) - Math.max(min[1], y));
        const depth = Math.max(0, Math.min(max[2], z + 1) - Math.max(min[2], z));
        immersedVolume += width * height * depth;
        if (x === cameraVoxelX && z === cameraVoxelZ)
          waterSurfaceY = Math.max(waterSurfaceY ?? Number.NEGATIVE_INFINITY, surfaceY);
      }
  const bodyFraction = clamp01(immersedVolume / bodyVolume);
  const cameraDepth = waterSurfaceY === null ? Number.NEGATIVE_INFINITY : waterSurfaceY - cameraY;
  const cameraSubmerged = input.previousCameraSubmerged
    ? cameraDepth >= -CAMERA_EXIT_CLEARANCE
    : cameraDepth >= CAMERA_ENTER_DEPTH;
  return {
    bodyFraction,
    wading: bodyFraction >= WADING_FRACTION,
    swimming: bodyFraction >= SWIMMING_FRACTION,
    cameraSubmerged,
    cameraDepth,
    waterSurfaceY,
  };
}
