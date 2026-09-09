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

export type VoxelPosition = readonly [number, number, number];
export type LocalShadowCaster = Readonly<{ id: string; revision: number; position: VoxelPosition }>;

export const LOCAL_LIGHT_RANGE = 8;
const LOCAL_SHADOW_CASTER_MARGIN = 2;

const samePosition = (left: VoxelPosition, right: VoxelPosition) =>
  left[0] === right[0] && left[1] === right[1] && left[2] === right[2];

export function reconcileLocalLightSlots(
  previous: readonly VoxelPosition[],
  selected: readonly VoxelPosition[],
  limit: number,
): [number, number, number][] {
  const retained = previous.filter((position) => selected.some((candidate) => samePosition(position, candidate)));
  const additions = selected.filter((position) => !retained.some((candidate) => samePosition(position, candidate)));
  return [...retained, ...additions].slice(0, limit).map((position) => [position[0], position[1], position[2]]);
}

export function localShadowNeedsUpdate({
  previousWorldRevision,
  worldRevision,
  previousCasterSignature,
  casterSignature,
  slotsChanged,
}: Readonly<{
  previousWorldRevision: number;
  worldRevision: number;
  previousCasterSignature: string;
  casterSignature: string;
  slotsChanged: boolean;
}>): boolean {
  return slotsChanged || previousWorldRevision !== worldRevision || previousCasterSignature !== casterSignature;
}

export function localShadowCasterSignature(
  lightSlots: readonly VoxelPosition[],
  shadowedLightLimit: number,
  casters: readonly LocalShadowCaster[],
): string {
  const rangeSquared = (LOCAL_LIGHT_RANGE + LOCAL_SHADOW_CASTER_MARGIN) ** 2;
  const shadowedSlots = lightSlots.slice(0, shadowedLightLimit);
  return JSON.stringify(
    casters
      .filter((caster) =>
        shadowedSlots.some((slot) => {
          const dx = caster.position[0] - (slot[0] + 0.5);
          const dy = caster.position[1] - (slot[1] + 0.46);
          const dz = caster.position[2] - (slot[2] + 0.5);
          return dx * dx + dy * dy + dz * dz <= rangeSquared;
        }),
      )
      .map(({ id, revision }) => [id, revision] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

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
