import { waterSurfaceHeight } from '../../world/water-mesh-height';

export const waterReflectionSurfaceY = (voxelY: number, level: number, coveredByWater: boolean): number | null =>
  coveredByWater ? null : voxelY + waterSurfaceHeight(level, false);

export const reflectionPlaneAboveCamera = (waterPlaneY: number | null, cameraY: number): number | null =>
  waterPlaneY !== null && cameraY > waterPlaneY ? waterPlaneY : null;
