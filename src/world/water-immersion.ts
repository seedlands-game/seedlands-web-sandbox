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
  position: readonly [number, number, number];
  feetOffset: number;
  headOffset: number;
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
  const [rawX, cameraY, rawZ] = input.position;
  const x = Math.floor(rawX);
  const z = Math.floor(rawZ);
  const bodyBottom = cameraY - input.feetOffset;
  const bodyTop = cameraY + input.headOffset;
  const bodyHeight = Math.max(0.001, bodyTop - bodyBottom);
  let immersedHeight = 0;
  let waterSurfaceY: number | null = null;
  for (let y = Math.floor(bodyBottom); y <= Math.floor(bodyTop); y += 1) {
    if (input.getVoxel(x, y, z) !== Voxel.Water) continue;
    const level = input.getFluidLevel(x, y, z) ?? 8;
    const covered = input.getVoxel(x, y + 1, z) === Voxel.Water;
    const surfaceY = y + waterSurfaceHeight(level, covered);
    waterSurfaceY = Math.max(waterSurfaceY ?? Number.NEGATIVE_INFINITY, surfaceY);
    immersedHeight += Math.max(0, Math.min(bodyTop, surfaceY) - Math.max(bodyBottom, y));
  }
  const bodyFraction = clamp01(immersedHeight / bodyHeight);
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
