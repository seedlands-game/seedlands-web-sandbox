import type { QualityLevel } from './quality-profile';

export type LightingQualityBudget = {
  sunShadowResolution: 0 | 512 | 1024;
  maxLocalLights: number;
  maxShadowedLocalLights: number;
  localShadowResolution: 0 | 128 | 256;
  horizontalScanRadius: number;
  verticalScanRadius: number;
  scanIntervalSeconds: number;
  reflectionResolution: 0 | 128 | 256;
  reflectionFrameInterval: number;
  reflectionSearchRadius: number;
  postProcessing: boolean;
  colorGradeStrength: number;
};

export const LIGHTING_QUALITY_BUDGETS: Record<QualityLevel, LightingQualityBudget> = {
  low: {
    sunShadowResolution: 0,
    maxLocalLights: 2,
    maxShadowedLocalLights: 0,
    localShadowResolution: 0,
    horizontalScanRadius: 10,
    verticalScanRadius: 6,
    scanIntervalSeconds: 0.5,
    reflectionResolution: 0,
    reflectionFrameInterval: 0,
    reflectionSearchRadius: 0,
    postProcessing: false,
    colorGradeStrength: 0,
  },
  medium: {
    sunShadowResolution: 512,
    maxLocalLights: 4,
    maxShadowedLocalLights: 1,
    localShadowResolution: 128,
    horizontalScanRadius: 14,
    verticalScanRadius: 8,
    scanIntervalSeconds: 0.5,
    reflectionResolution: 128,
    reflectionFrameInterval: 8,
    reflectionSearchRadius: 10,
    postProcessing: true,
    colorGradeStrength: 0.18,
  },
  high: {
    sunShadowResolution: 1024,
    maxLocalLights: 6,
    maxShadowedLocalLights: 2,
    localShadowResolution: 256,
    horizontalScanRadius: 18,
    verticalScanRadius: 10,
    scanIntervalSeconds: 0.5,
    reflectionResolution: 256,
    reflectionFrameInterval: 4,
    reflectionSearchRadius: 14,
    postProcessing: true,
    colorGradeStrength: 0.3,
  },
};

type VoxelPosition = readonly [number, number, number];

export function selectNearestLanterns(
  origin: VoxelPosition,
  candidates: readonly VoxelPosition[],
  limits: { horizontalRadius: number; verticalRadius: number; limit: number },
): [number, number, number][] {
  const horizontalRadiusSquared = limits.horizontalRadius ** 2;
  return candidates
    .filter(([x, y, z]) => {
      const dx = x + 0.5 - origin[0];
      const dz = z + 0.5 - origin[2];
      return Math.abs(y + 0.5 - origin[1]) <= limits.verticalRadius && dx * dx + dz * dz <= horizontalRadiusSquared;
    })
    .map((position) => ({
      position,
      distance:
        (position[0] + 0.5 - origin[0]) ** 2 +
        (position[1] + 0.5 - origin[1]) ** 2 +
        (position[2] + 0.5 - origin[2]) ** 2,
    }))
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        left.position[0] - right.position[0] ||
        left.position[1] - right.position[1] ||
        left.position[2] - right.position[2],
    )
    .slice(0, limits.limit)
    .map(({ position }) => [position[0], position[1], position[2]]);
}
